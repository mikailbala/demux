import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import ora from 'ora';

import { parseSampleSheet } from '../parsers/samplesheet.js';
import { parseTopUnknown } from '../parsers/topunknown.js';

import { resolveColumns } from '../core/filter.js';
import { prefixMatch, applySubstitutions } from '../core/rescue.js';

import { serializeSampleSheet } from '../generators/samplesheet.js';
import { renderSbatch } from '../generators/sbatch.js';

import { existingStateDir, nextRescueName, createStateDir, writeText } from '../state/statedir.js';
import { readDecisions, writeDecisions } from '../state/decisions.js';
import { runRun } from './run.js';

import { errors, formatError, DemuxError } from '../ui/errors.js';
import { renderCandidatesTable } from '../ui/candidates.js';
import { confirm, selectMany, divider } from '../ui/prompts.js';
import { c, sym, header, step } from '../ui/theme.js';

const TOTAL_STEPS = 5;

export async function runRescue(prevDir, opts = {}) {
  const prevAbs = resolve(prevDir);
  const prev = await loadPrevState(prevAbs);

  process.stdout.write(header('demux rescue', `from ${prev.decisions.runId}`));
  console.log(step(1, TOTAL_STEPS, 'Loading previous state'));
  console.log(`  ${sym.ok} decisions  ${c.dim(prev.statePaths.paths.decisions)}`);
  console.log(`  ${sym.ok} samplesheet ${c.dim(prev.statePaths.samplesheet)}`);

  console.log('\n' + step(2, TOTAL_STEPS, 'Locating TopUnknownBarcodes.csv'));
  const topPath = await resolveTopUnknownPath(prev, opts);
  console.log(`  ${sym.ok} ${c.dim(topPath)}`);
  const topText = await readFile(topPath, 'utf-8');
  const topUnknown = parseTopUnknown(topText);
  console.log(`  ${sym.info} ${c.bold(topUnknown.length)} unknown barcodes`);

  console.log('\n' + step(3, TOTAL_STEPS, 'Prefix-matching against samplesheet'));
  const sheet = prev.samplesheet;
  const rows = sheet.data;
  const n = opts.matchLen ?? prev.decisions.rescue?.matchLen ?? 8;
  const dual = !!resolveColumns(rows).index2;
  const matches = prefixMatch(rows, topUnknown, { n, dual });

  if (matches.length === 0) {
    console.log(`  ${sym.warn} no prefix matches with N=${n}; nothing to rescue`);
    return;
  }

  console.log('');
  console.log(renderCandidatesTable(matches));
  console.log('');

  console.log(step(4, TOTAL_STEPS, 'Pick substitutions'));
  const choices = matches.map((m) => ({
    name: `${m.sampleId}  ${c.dim('→')}  ${m.candidates[0].unknown.index}${m.candidates[0].unknown.index2 ? '+' + m.candidates[0].unknown.index2 : ''}  ${c.dim(`(${m.candidates[0].reads.toLocaleString()} reads)`)}`,
    value: m.sampleId,
    checked: m.candidates[0].confidence > 0.005,
  }));
  const picked = await selectMany('Apply substitutions for these samples', choices);
  if (picked.length === 0) {
    console.log(`${sym.warn} no substitutions selected; aborting`);
    return;
  }

  const subs = new Map();
  for (const m of matches) {
    if (!picked.includes(m.sampleId)) continue;
    const top = m.candidates[0];
    subs.set(m.sampleId, { newI7: top.unknown.index, newI5: top.unknown.index2 || undefined });
  }
  const finalData = applySubstitutions(rows, subs);

  console.log('\n' + step(5, TOTAL_STEPS, 'Writing rescue state dir'));
  const newBase = await nextRescueName(prev.statePaths.base);
  const newState = await createStateDir(newBase.split('/').pop(), { cwd: prev.statePaths.base.replace(/\/[^/]+$/, '') });

  const overrideCycles = prev.decisions.overrideCycles ?? undefined;
  const perLaneOverrideCycles = !!prev.decisions.perLaneOverrideCycles;
  const finalCsv = serializeSampleSheet(sheet, {
    data: finalData,
    overrideCycles: perLaneOverrideCycles ? undefined : overrideCycles,
    dropSettings: prev.decisions.strippedSettings || [],
  });
  const bclConvert = prev.decisions.bclConvert || { path: '~/bin/bclConvert/usr/bin/bcl-convert', version: null };
  const sbatchText = prev.decisions.sbatch
    ? renderSbatch({
        ...prev.decisions.sbatch,
        JOB_TAG: `${prev.decisions.runId}-rescue`,
        RUNDIR: prev.decisions.rundir,
        OUTPUT_DIR: newState.outputDir,
        SAMPLESHEET: newState.samplesheet,
        STATE_DIR: newState.stateDir,
        BCL_CONVERT_PATH: bclConvert.path,
      })
    : null;

  const writes = [
    writeText(newState.samplesheet, finalCsv),
    writeText(newState.paths.original, sheet.raw),
    writeText(newState.paths.filtered, finalCsv),
    writeText(newState.paths.final, finalCsv),
    writeText(newState.paths.topUnknownSnapshot, topText),
    writeDecisions(newState.paths.decisions, {
      command: 'rescue',
      derivedFrom: prev.statePaths.base,
      rundir: prev.decisions.rundir,
      runId: prev.decisions.runId,
      filterCriteria: prev.decisions.filterCriteria,
      overrideCycles: perLaneOverrideCycles ? null : overrideCycles,
      perLaneOverrideCycles: prev.decisions.perLaneOverrideCycles,
      reverseComplement: prev.decisions.reverseComplement,
      rescue: { matchLen: n, topUnknownPath: topPath, applied: subs.size },
      substitutions: [...subs.entries()].map(([id, v]) => ({ sampleId: id, ...v })),
      sbatch: prev.decisions.sbatch,
      bclConvert,
      strippedSettings: prev.decisions.strippedSettings || [],
    }),
  ];
  if (sbatchText) writes.push(writeText(newState.sbatch, sbatchText));
  await Promise.all(writes);

  console.log(`  ${sym.ok} ${c.dim(newState.samplesheet)}`);
  if (sbatchText) console.log(`  ${sym.ok} ${c.dim(newState.sbatch)}`);
  console.log('');
  console.log(c.brand(`${sym.ok} next steps`));
  if (sbatchText) console.log(`  ${c.cyan('sbatch')} ${newState.sbatch}`);
  console.log(`  ${c.dim('or:')}     ${c.cyan('demux run')} ${newState.base}`);
  console.log('');

  if (opts.run) {
    await runRun(newState.base, { threads: opts.threads, bclConvert: opts.bclConvert, force: opts.force });
  }
}

async function loadPrevState(prevAbs) {
  let statePaths;
  try {
    statePaths = await existingStateDir(prevAbs);
  } catch {
    throw new DemuxError(`No .demux state dir found in ${prevAbs}`, {
      code: 'E_NO_STATE',
      hint: 'Point at a directory created by `demux init` (it has a .demux/ subdir).',
    });
  }

  const decisions = await readDecisions(statePaths.paths.decisions);
  const sheetText = await readFile(statePaths.samplesheet, 'utf-8');
  const samplesheet = parseSampleSheet(sheetText);

  return { statePaths, decisions, samplesheet };
}

async function resolveTopUnknownPath(prev, opts) {
  if (opts.topUnknown) {
    const p = resolve(opts.topUnknown);
    try { await access(p, constants.R_OK); return p; } catch { throw errors.noTopUnknown(p); }
  }
  const candidates = [
    join(prev.statePaths.outputDir, 'Reports', 'TopUnknownBarcodes.csv'),
    join(prev.statePaths.base, 'Reports', 'TopUnknownBarcodes.csv'),
  ];
  for (const p of candidates) {
    try { await access(p, constants.R_OK); return p; } catch {}
  }
  throw errors.noTopUnknown(candidates[0]);
}
