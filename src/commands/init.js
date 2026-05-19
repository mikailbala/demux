import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import ora from 'ora';
import logUpdate from 'log-update';

import { parseRunInfo, cyclesString, isDualIndexed } from '../parsers/runinfo.js';
import { parseSampleSheet } from '../parsers/samplesheet.js';
import { parseTopUnknown } from '../parsers/topunknown.js';

import { applyFilter, resolveColumns, laneOptions } from '../core/filter.js';
import { applyRC, previewIndices, revcomp } from '../core/revcomp.js';
import { suggestOverride, validateOverride } from '../core/cycles.js';
import { prefixMatch, applySubstitutions } from '../core/rescue.js';
import { discoverBclConvert, getBclVersion, getDeclaredSoftwareVersion } from '../core/bcl-convert.js';

import {
  serializeSampleSheet,
  findStrippedSettings,
  hasPerLaneOverrideCycles,
  uniquePerLaneOverrides,
} from '../generators/samplesheet.js';
import { renderSbatch } from '../generators/sbatch.js';

import { createStateDir, writeText } from '../state/statedir.js';
import { writeDecisions } from '../state/decisions.js';
import { runRun } from './run.js';

import {
  errors,
  formatError,
  detectDuplicateIds,
  detectIllegalIds,
  DemuxError,
} from '../ui/errors.js';
import { runSummary, filterPreview, samplesheetPreview } from '../ui/summary.js';
import { renderCandidatesTable } from '../ui/candidates.js';
import { confirm, ask, selectOne, selectMany, divider } from '../ui/prompts.js';
import { c, sym, header, step } from '../ui/theme.js';

const TOTAL_STEPS = 8;

export async function runInit(rundir, opts = {}) {
  const rundirAbs = resolve(rundir);

  // Step 1: validate + parse
  await validateRundir(rundirAbs, opts);
  const spin = ora({ text: 'Parsing run metadata…', spinner: 'dots' }).start();
  let runInfo, samplesheet;
  try {
    const runInfoText = await readFile(join(rundirAbs, 'RunInfo.xml'), 'utf-8');
    runInfo = parseRunInfo(runInfoText);
    const sheetPath = opts.samplesheet
      ? resolve(opts.samplesheet)
      : join(rundirAbs, 'SampleSheet.csv');
    const sheetText = await readFile(sheetPath, 'utf-8');
    samplesheet = parseSampleSheet(sheetText);
    spin.succeed(`Parsed RunInfo + SampleSheet (${c.bold(samplesheet.data.length)} samples)`);
  } catch (e) {
    spin.fail('Failed to parse run metadata');
    throw e;
  }

  // Header + summary
  process.stdout.write(header(`demux init`, `${runInfo.runId}`));
  process.stdout.write(runSummary(runInfo, samplesheet) + '\n\n');

  // Step 2: bcl-convert selection
  console.log(step(2, TOTAL_STEPS, 'bcl-convert binary'));
  const bcl = await chooseBclConvert(samplesheet, opts);

  // Step 3: filter
  console.log('\n' + step(3, TOTAL_STEPS, 'Sample selection'));
  const { filtered, criteria } = await interactiveFilter(samplesheet.data);

  // Step 4: override cycles
  console.log('\n' + step(4, TOTAL_STEPS, 'Override cycles'));
  const perLane = hasPerLaneOverrideCycles(filtered);
  const overrideCycles = perLane
    ? handlePerLaneOverrideCycles(filtered)
    : await chooseOverrideCycles(runInfo);

  // Step 5: reverse complement
  console.log('\n' + step(5, TOTAL_STEPS, 'Reverse complement'));
  const { rc, withRC } = await chooseReverseComplement(filtered, runInfo);

  // Step 6: optional rescue
  console.log('\n' + step(6, TOTAL_STEPS, 'Index rescue (TopUnknownBarcodes)'));
  let { final, substitutions, rescueMeta } = { final: withRC, substitutions: new Map(), rescueMeta: null };
  if (opts.topUnknown) {
    const res = await rescueFromTopUnknown(withRC, opts.topUnknown, runInfo, opts);
    final = res.final;
    substitutions = res.substitutions;
    rescueMeta = res.meta;
  } else {
    console.log(c.dim('  · skipped (no --top-unknown provided)'));
  }

  // Validate the final set
  validateFinalSet(final, runInfo, overrideCycles);

  // Detect BCLConvert_Settings keys that bcl-convert will reject. Catches
  // unsupported keys (AutoDetectDemuxMode, FastqcDownsampling), UMI-required
  // settings without U cycles (TrimUMI), and global OverrideCycles when per-lane
  // is in [Data].
  const strippedSettings = findStrippedSettings(samplesheet, {
    drop: opts.dropSettings ? opts.dropSettings.split(',').map((s) => s.trim()).filter(Boolean) : [],
    keepAll: opts.keepAllSettings,
    overrideCycles: perLane ? undefined : overrideCycles,
    data: final,
  });
  if (strippedSettings.length) {
    console.log('');
    console.log(`${sym.warn} ${c.bold(`stripping ${strippedSettings.length} BCLConvert setting(s):`)}`);
    for (const s of strippedSettings) {
      console.log(`  ${c.dim('·')} ${s.key} = ${c.dim(s.value)}  ${c.muted(`(${s.reason})`)}`);
    }
    console.log(`  ${c.dim('(pass --keep-all-settings to disable stripping)')}`);
  }

  // Step 7: confirm + write
  console.log('\n' + step(7, TOTAL_STEPS, 'Review'));
  console.log(divider('Final samplesheet preview'));
  console.log(samplesheetPreview(final, 10));
  console.log('');

  const sbatchVars = opts.run ? null : await collectSbatchVars(runInfo);

  if (sbatchVars) {
    console.log(divider('Sbatch parameters'));
    for (const [k, v] of Object.entries(sbatchVars)) {
      console.log(`  ${c.label(k.padEnd(14))} ${c.muted(v)}`);
    }
    console.log('');
  } else {
    console.log(`${sym.info} ${c.dim('--run set; will execute bcl-convert directly after write (no sbatch script)')}`);
    console.log('');
  }

  const proceed = await confirm(`Write artifacts and finish?`, { default: true });
  if (!proceed) {
    console.log(`${sym.warn} Aborted. No files written.`);
    return;
  }

  // Step 8: write
  console.log('\n' + step(8, TOTAL_STEPS, 'Writing artifacts'));
  const stateDir = await writeArtifacts({
    rundir: rundirAbs,
    runInfo,
    samplesheet,
    finalData: final,
    overrideCycles: perLane ? undefined : overrideCycles,
    sbatchVars,
    bclConvert: bcl,
    strippedSettings: strippedSettings.map((s) => s.key),
    keepAllSettings: !!opts.keepAllSettings,
    decisions: {
      command: 'init',
      rundir: rundirAbs,
      runId: runInfo.runId,
      filterCriteria: criteria,
      overrideCycles: perLane ? null : overrideCycles,
      perLaneOverrideCycles: perLane ? uniquePerLaneOverrides(final) : null,
      reverseComplement: rc,
      rescue: rescueMeta,
      substitutions: serializeSubstitutions(substitutions),
      sbatch: sbatchVars,
      bclConvert: bcl,
      strippedSettings: strippedSettings.map((s) => s.key),
    },
  });

  if (opts.run) {
    console.log('');
    await runRun(stateDir.base, { threads: opts.threads, bclConvert: bcl.path, force: opts.force });
  }
}

async function validateRundir(rundirAbs, opts) {
  let entries = [];
  try {
    entries = await readdir(rundirAbs);
  } catch {
    throw errors.missingRunInfo(rundirAbs, []);
  }
  if (!entries.includes('RunInfo.xml')) {
    throw errors.missingRunInfo(rundirAbs, entries);
  }
  if (!opts.samplesheet && !entries.includes('SampleSheet.csv')) {
    throw errors.missingSampleSheet(rundirAbs);
  }
}

async function interactiveFilter(allRows) {
  const cols = resolveColumns(allRows);
  let criteria = { lanes: [], regex: null, idList: [] };
  let filtered = allRows;

  while (true) {
    console.log(filterPreview({
      matched: filtered.length,
      total: allRows.length,
      sampleIds: cols.sampleId ? filtered.map((r) => r[cols.sampleId]) : [],
    }));

    const action = await selectOne('Refine selection?', [
      { name: c.ok('use current selection'), value: 'done' },
      { name: 'filter by lane', value: 'lane' },
      { name: 'filter by Sample_ID/Name regex', value: 'regex' },
      { name: 'filter by explicit Sample_ID list', value: 'ids' },
      { name: c.dim('reset filters'), value: 'reset' },
    ], { default: 'done' });

    if (action === 'done') break;
    if (action === 'reset') {
      criteria = { lanes: [], regex: null, idList: [] };
      filtered = allRows;
      continue;
    }

    if (action === 'lane') {
      const lanes = laneOptions(allRows);
      if (lanes.length === 0) {
        console.log(`${sym.warn} no Lane column in samplesheet`);
        continue;
      }
      const picked = await selectMany('Pick lane(s)', lanes.map((l) => ({ name: l, value: l, checked: criteria.lanes.includes(l) })), { required: true });
      criteria = { ...criteria, lanes: picked };
    } else if (action === 'regex') {
      const re = await ask('Regex against Sample_ID / Sample_Name', {
        default: criteria.regex ?? '',
        validate: (v) => {
          if (!v) return true;
          try { new RegExp(v); return true; } catch (e) { return `invalid regex: ${e.message}`; }
        },
      });
      criteria = { ...criteria, regex: re || null };
    } else if (action === 'ids') {
      const list = await ask('Sample_IDs (comma or whitespace separated)', {
        default: criteria.idList.join(','),
      });
      const ids = list.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      criteria = { ...criteria, idList: ids };
    }

    try {
      filtered = applyFilter(allRows, criteria);
    } catch (e) {
      console.log(formatError(e));
      filtered = allRows;
    }
  }

  if (filtered.length === 0) {
    throw new DemuxError('Filter resolved to zero samples', {
      code: 'E_EMPTY_FILTER',
      hint: 'Loosen the criteria or reset filters.',
    });
  }

  return { filtered, criteria };
}

async function chooseOverrideCycles(runInfo) {
  const suggested = suggestOverride(runInfo);
  console.log(`  ${c.dim('detected from RunInfo:')} ${c.bold(suggested)}`);
  const skip = await confirm(`Use detected cycles (no override)?`, { default: true });
  if (skip) return '';

  while (true) {
    const value = await ask('OverrideCycles string', {
      default: suggested,
      validate: (v) => {
        const r = validateOverride(v);
        return r.ok || r.hint;
      },
    });
    return value.trim();
  }
}

async function chooseReverseComplement(rows, runInfo) {
  const dual = isDualIndexed(runInfo);
  const samples = previewIndices(rows, 3);

  console.log(c.dim('  sample indices (first 3):'));
  for (const s of samples) {
    const i5part = dual ? `  i5=${c.bold(s.i5)} → rc=${c.dim(safeRC(s.i5))}` : '';
    console.log(`    ${c.muted(s.sampleId.padEnd(20))}  i7=${c.bold(s.i7)} → rc=${c.dim(safeRC(s.i7))}${i5part}`);
  }

  const rc = { i7: false, i5: false };
  rc.i7 = await confirm('Reverse-complement i7 (Index1)?', { default: false });
  if (dual) {
    rc.i5 = await confirm('Reverse-complement i5 (Index2)?', { default: false });
  }
  return { rc, withRC: applyRC(rows, rc) };
}

function safeRC(s) {
  if (!s) return '';
  try { return revcomp(s); } catch { return '?'; }
}

async function rescueFromTopUnknown(rows, topUnknownPath, runInfo, opts) {
  const resolved = resolve(topUnknownPath);
  try {
    await access(resolved, constants.R_OK);
  } catch {
    throw errors.noTopUnknown(resolved);
  }
  const text = await readFile(resolved, 'utf-8');
  const topUnknown = parseTopUnknown(text);
  console.log(`  ${sym.info} loaded ${c.bold(topUnknown.length)} unknown barcodes from ${c.dim(resolved)}`);

  const n = opts.matchLen ?? 8;
  const matches = prefixMatch(rows, topUnknown, { n, dual: isDualIndexed(runInfo) });

  if (matches.length === 0) {
    console.log(`  ${sym.warn} no prefix matches (N=${n}); rescue skipped`);
    return { final: rows, substitutions: new Map(), meta: { matchLen: n, topUnknownPath: resolved, applied: 0 } };
  }

  console.log('');
  console.log(renderCandidatesTable(matches));
  console.log('');

  const choices = matches.map((m) => ({
    name: `${m.sampleId}  ${c.dim('→')}  ${m.candidates[0].unknown.index}${m.candidates[0].unknown.index2 ? '+' + m.candidates[0].unknown.index2 : ''}  ${c.dim(`(${m.candidates[0].reads.toLocaleString()} reads)`)}`,
    value: m.sampleId,
    checked: m.candidates[0].confidence > 0.005,
  }));
  const picked = await selectMany('Apply substitutions for these samples', choices);
  const subs = new Map();
  for (const m of matches) {
    if (!picked.includes(m.sampleId)) continue;
    const top = m.candidates[0];
    subs.set(m.sampleId, { newI7: top.unknown.index, newI5: top.unknown.index2 || undefined });
  }
  return {
    final: applySubstitutions(rows, subs),
    substitutions: subs,
    meta: { matchLen: n, topUnknownPath: resolved, applied: subs.size },
  };
}

function validateFinalSet(rows, runInfo, overrideCycles) {
  const cols = resolveColumns(rows);
  if (cols.sampleId) {
    const dupes = detectDuplicateIds(rows, cols.sampleId, cols.lane);
    if (dupes.length) throw errors.duplicateSampleIds(dupes);
    const illegal = detectIllegalIds(rows, cols.sampleId);
    if (illegal.length) throw errors.illegalSampleIdChars(illegal);
  }
  // Cycle vs index-length sanity check (only without override; override is the user's escape hatch)
  if (!overrideCycles) {
    const idxReads = runInfo.reads.filter((r) => r.isIndex);
    if (cols.index && idxReads[0] && rows.length) {
      const found = String(rows[0][cols.index] ?? '').length;
      if (found && found !== idxReads[0].cycles) {
        throw errors.indexCycleMismatch({ idx: 1, declared: idxReads[0].cycles, found });
      }
    }
    if (cols.index2 && idxReads[1] && rows.length) {
      const found = String(rows[0][cols.index2] ?? '').length;
      if (found && found !== idxReads[1].cycles) {
        throw errors.indexCycleMismatch({ idx: 2, declared: idxReads[1].cycles, found });
      }
    }
  }
}

async function collectSbatchVars(runInfo) {
  const partition = await ask('SLURM --partition (empty to leave unset)', { default: '' });
  const account = await ask('SLURM --account (empty to leave unset)', { default: '' });
  const cpus = await ask('CPUs per task', { default: '32' });
  const mem = await ask('Memory', { default: '240G' });
  const walltime = await ask('Walltime', { default: '12:00:00' });
  return {
    PARTITION: partition.trim(),
    ACCOUNT: account.trim(),
    CPUS: cpus.trim(),
    MEM: mem.trim(),
    WALLTIME: walltime.trim(),
  };
}

async function writeArtifacts({ rundir, runInfo, samplesheet, finalData, overrideCycles, sbatchVars, bclConvert, strippedSettings, keepAllSettings, decisions }) {
  const stateDir = await createStateDir(runInfo.runId);

  const serializeOpts = {
    data: finalData,
    overrideCycles,
    dropSettings: strippedSettings,
    keepAllSettings,
  };
  const finalCsv = serializeSampleSheet(samplesheet, serializeOpts);
  const filteredCsv = serializeSampleSheet(samplesheet, { ...serializeOpts, overrideCycles: undefined });

  const writes = [
    writeText(stateDir.samplesheet, finalCsv),
    writeText(stateDir.paths.original, samplesheet.raw),
    writeText(stateDir.paths.filtered, filteredCsv),
    writeText(stateDir.paths.final, finalCsv),
    writeText(stateDir.paths.runinfoSnapshot, JSON.stringify(runInfo, null, 2)),
    writeDecisions(stateDir.paths.decisions, decisions),
  ];

  if (sbatchVars) {
    const sbatchText = renderSbatch({
      ...sbatchVars,
      JOB_TAG: runInfo.runId,
      RUNDIR: rundir,
      OUTPUT_DIR: stateDir.outputDir,
      SAMPLESHEET: stateDir.samplesheet,
      STATE_DIR: stateDir.stateDir,
      BCL_CONVERT_PATH: bclConvert.path,
    });
    writes.push(writeText(stateDir.sbatch, sbatchText));
  }

  await Promise.all(writes);

  console.log(`  ${sym.ok} samplesheet  ${c.dim(stateDir.samplesheet)}`);
  if (sbatchVars) {
    console.log(`  ${sym.ok} sbatch       ${c.dim(stateDir.sbatch)}`);
  }
  console.log(`  ${sym.ok} state dir    ${c.dim(stateDir.stateDir)}`);
  console.log('');
  if (sbatchVars) {
    console.log(c.brand(`${sym.ok} next steps`));
    console.log(`  ${c.cyan('sbatch')} ${stateDir.sbatch}`);
    console.log(`  ${c.dim('or run interactively:')} ${c.cyan('demux run')} ${stateDir.base}`);
    console.log(`  ${c.dim('logs will land in:')} ${c.dim(stateDir.stateDir + '/bcl-convert.{stdout,stderr}.log')}`);
    console.log(`  ${c.dim('after demux, rescue with:')} ${c.cyan('demux rescue')} ${stateDir.base}`);
    console.log('');
  }

  return stateDir;
}

function serializeSubstitutions(subs) {
  return [...subs.entries()].map(([id, v]) => ({ sampleId: id, ...v }));
}

async function chooseBclConvert(samplesheet, opts) {
  const explicit = opts.bclConvert ?? process.env.DEMUX_BCL_CONVERT;
  const declared = getDeclaredSoftwareVersion(samplesheet);

  if (explicit) {
    const version = (await getBclVersion(explicit)) ?? null;
    if (!version) {
      throw new DemuxError(`Cannot run --version on ${explicit}`, {
        code: 'E_BCL_NOT_RUNNABLE',
        hint: 'Check the path is correct and the binary is executable on this node.',
      });
    }
    console.log(`  ${sym.ok} using ${c.bold(explicit)} ${c.muted(`(v${version})`)}`);
    if (declared) {
      reportVersionMatch(declared, version);
    }
    return { path: explicit, version };
  }

  const spin = ora({ text: 'Discovering bcl-convert binaries…', spinner: 'dots' }).start();
  const found = await discoverBclConvert();
  spin.stop();

  if (found.length === 0) {
    console.log(`  ${sym.warn} no bcl-convert binary discovered automatically`);
    const path = await ask('Path to bcl-convert binary', {
      validate: async (v) => {
        if (!v.trim()) return 'required';
        const ver = await getBclVersion(v.trim()).catch(() => null);
        return ver ? true : 'binary not runnable; check path + executable bit';
      },
    });
    const version = await getBclVersion(path.trim());
    if (declared) reportVersionMatch(declared, version);
    return { path: path.trim(), version };
  }

  if (declared) {
    console.log(`  ${c.dim('samplesheet declares:')} ${c.bold(declared)}`);
  }

  let picked;
  if (found.length === 1) {
    const only = found[0];
    console.log(`  ${sym.info} found ${c.bold(only.path)} ${c.muted(`(v${only.version ?? '?'})`)}`);
    const ok = await confirm('Use this bcl-convert?', { default: true });
    if (ok) {
      picked = only;
    } else {
      const path = await ask('Path to bcl-convert binary');
      const version = await getBclVersion(path.trim());
      picked = { path: path.trim(), version };
    }
  } else {
    console.log(`  ${sym.info} ${c.bold(found.length)} binaries found:`);
    const choices = found.map((f, i) => ({
      name: `${f.path}  ${c.muted(`(v${f.version ?? '?'})`)}${declared && f.version === declared ? c.ok('  ← matches samplesheet') : ''}`,
      value: i,
    }));
    choices.push({ name: c.dim('(other — type a path)'), value: -1 });
    const idx = await selectOne('Pick which bcl-convert to use', choices, { default: 0 });
    if (idx === -1) {
      const path = await ask('Path to bcl-convert binary');
      const version = await getBclVersion(path.trim());
      picked = { path: path.trim(), version };
    } else {
      picked = found[idx];
    }
  }

  if (declared && picked.version) reportVersionMatch(declared, picked.version);
  console.log(`  ${sym.ok} selected ${c.bold(picked.path)} ${c.muted(`(v${picked.version ?? '?'})`)}`);
  console.log(`  ${c.dim('tip: set DEMUX_BCL_CONVERT or pass --bcl-convert to skip this prompt next time')}`);
  return picked;
}

function reportVersionMatch(declared, installed) {
  if (!declared || !installed) return;
  if (declared === installed) {
    console.log(`  ${sym.ok} version matches samplesheet ${c.muted(`(v${installed})`)}`);
  } else {
    console.log(`  ${sym.warn} version mismatch: samplesheet says ${c.bold(declared)}, installed is ${c.bold(installed)}`);
  }
}

function handlePerLaneOverrideCycles(rows) {
  const variants = uniquePerLaneOverrides(rows);
  console.log(`  ${sym.info} per-lane OverrideCycles found in [BCLConvert_Data]:`);
  for (const v of variants) {
    console.log(`    ${c.dim('·')} ${c.bold(v.cycles)}  ${c.muted(`(${v.count} sample${v.count === 1 ? '' : 's'})`)}`);
  }
  console.log(`  ${c.dim('global OverrideCycles will be removed from [BCLConvert_Settings] to avoid conflict')}`);
  return undefined; // explicit: caller passes this through to serializer, perLane flag drives stripping
}
