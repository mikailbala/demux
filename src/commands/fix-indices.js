import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { parseSampleSheet } from '../parsers/samplesheet.js';
import { serializeSampleSheet } from '../generators/samplesheet.js';
import { renderSbatch } from '../generators/sbatch.js';

import {
  loadKits,
  detectKit,
  swapKit,
  listKits,
} from '../core/kits-10x.js';

import {
  existingStateDir,
  nextRescueName,
  createStateDir,
  writeText,
} from '../state/statedir.js';
import { readDecisions, writeDecisions } from '../state/decisions.js';

import { DemuxError } from '../ui/errors.js';
import { confirm, ask, selectOne, divider } from '../ui/prompts.js';
import { samplesheetPreview } from '../ui/summary.js';
import { c, sym, header } from '../ui/theme.js';

export async function runFixIndices(stateDirArg, opts = {}) {
  const paths = await loadPaths(stateDirArg);
  const decisions = await readDecisions(paths.paths.decisions);
  await loadKits();

  process.stdout.write(header('demux fix-indices', decisions.runId));

  const sheetText = await readFile(paths.samplesheet, 'utf-8');
  const sheet = parseSampleSheet(sheetText);
  const data = sheet.data;

  // === Detect current kit ===
  const detections = detectKit(data);
  if (detections.length === 0) {
    throw new DemuxError('No known 10x kit matches the samplesheet barcodes', {
      code: 'E_KIT_NOT_DETECTED',
      context: [`${data.length} samples scanned; no fingerprint matched ${listKits().length} known kits`],
      hint: 'Add a kit CSV to ./kits/ (or wherever your scripts/build-10x-kits.mjs reads from) and rebuild.',
    });
  }

  const top = detections[0];
  const perfect = top.matched === top.total;
  console.log(`${sym.info} ${c.bold('detected kit')}`);
  for (const cand of detections.slice(0, 3)) {
    const tag = cand === top ? c.ok('  ← top') : '';
    console.log(`  ${c.dim('·')} ${c.bold(cand.id)} workflow ${cand.workflow}  ${c.muted(`(${cand.matched}/${cand.total} rows)`)}  ${cand.name}${tag}`);
  }
  if (!perfect) {
    console.log(`  ${sym.warn} only ${top.matched}/${top.total} match the top candidate — review carefully`);
  }

  // === Resolve --from-kit / --to-kit ===
  const kits = listKits();
  const fromKitId = opts.fromKit ?? top.id;
  const fromWorkflow = opts.workflow ?? top.workflow;
  if (!kits.find((k) => k.id === fromKitId)) {
    throw new DemuxError(`Unknown --from-kit: ${fromKitId}`, {
      code: 'E_UNKNOWN_KIT',
      context: [`known kits: ${kits.map((k) => k.id).join(', ')}`],
    });
  }

  let toKitId = opts.toKit;
  if (!toKitId) {
    const choices = kits
      .filter((k) => k.id !== fromKitId)
      .map((k) => ({ name: `${k.id}  ${c.muted('·')}  ${k.name}`, value: k.id }));
    toKitId = await selectOne(`Swap ${fromKitId} → which kit?`, choices);
  } else if (!kits.find((k) => k.id === toKitId)) {
    throw new DemuxError(`Unknown --to-kit: ${toKitId}`, {
      code: 'E_UNKNOWN_KIT',
      context: [`known kits: ${kits.map((k) => k.id).join(', ')}`],
    });
  }
  const targetWorkflow = opts.targetWorkflow ?? fromWorkflow;

  // === Run swap ===
  const swap = swapKit(data, {
    fromKit: fromKitId,
    toKit: toKitId,
    workflow: fromWorkflow,
    targetWorkflow,
  });

  console.log('');
  console.log(divider('Swap summary'));
  console.log(`  ${c.label('from')} ${fromKitId} (workflow ${fromWorkflow})`);
  console.log(`  ${c.label('to')}   ${toKitId} (workflow ${targetWorkflow})`);
  console.log(`  ${c.label('swapped')} ${c.bold(swap.swapped.length)} samples`);
  if (swap.unmatched.length) {
    console.log(`  ${c.label('unchanged')} ${c.warn(swap.unmatched.length)} (no match in ${fromKitId}):`);
    for (const u of swap.unmatched.slice(0, 5)) {
      console.log(`    ${c.dim('·')} row ${u.rowIndex + 1}${u.sampleId ? ` (${u.sampleId})` : ''}`);
    }
    if (swap.unmatched.length > 5) console.log(c.dim(`    · …and ${swap.unmatched.length - 5} more`));
  }

  // === Preview ===
  console.log('');
  console.log(divider('Preview (first 10 rows)'));
  console.log(samplesheetPreview(swap.rows, 10));
  console.log('');

  const proceed = opts.yes || await confirm('Write fixed samplesheet to a new state dir?', { default: true });
  if (!proceed) {
    console.log(`${sym.warn} aborted; no files written.`);
    return;
  }

  // === Write new state dir as a sibling ===
  const newBase = await nextFixName(paths.base);
  const parentDir = paths.base.replace(/\/[^/]+\/?$/, '') || '.';
  const newName = newBase.split('/').pop();
  const newState = await createStateDir(newName, { cwd: parentDir });

  // Preserve OverrideCycles and other decisions from the source samplesheet.
  const finalCsv = serializeSampleSheet(sheet, {
    data: swap.rows,
    overrideCycles: decisions.overrideCycles ?? undefined,
    dropSettings: decisions.strippedSettings ?? [],
    keepAllSettings: false,
  });

  const writes = [
    writeText(newState.samplesheet, finalCsv),
    writeText(newState.paths.original, sheet.raw),
    writeText(newState.paths.filtered, finalCsv),
    writeText(newState.paths.final, finalCsv),
    writeDecisions(newState.paths.decisions, {
      command: 'fix-indices',
      derivedFrom: paths.base,
      rundir: decisions.rundir,
      runId: decisions.runId,
      filterCriteria: decisions.filterCriteria,
      overrideCycles: decisions.overrideCycles,
      perLaneOverrideCycles: decisions.perLaneOverrideCycles,
      reverseComplement: decisions.reverseComplement,
      rescue: decisions.rescue,
      substitutions: decisions.substitutions,
      sbatch: decisions.sbatch,
      bclConvert: decisions.bclConvert,
      strippedSettings: decisions.strippedSettings,
      fixIndices: {
        fromKit: fromKitId,
        fromWorkflow,
        toKit: toKitId,
        targetWorkflow,
        swapped: swap.swapped.length,
        unmatched: swap.unmatched.length,
      },
    }),
  ];

  // Regenerate sbatch with the new paths if the prev run had one
  if (decisions.sbatch) {
    const sbatchText = renderSbatch({
      ...decisions.sbatch,
      JOB_TAG: `${decisions.runId}-fix`,
      RUNDIR: decisions.rundir,
      OUTPUT_DIR: newState.outputDir,
      SAMPLESHEET: newState.samplesheet,
      STATE_DIR: newState.stateDir,
      BCL_CONVERT_PATH: decisions.bclConvert?.path ?? '~/bin/bclConvert/usr/bin/bcl-convert',
    });
    writes.push(writeText(newState.sbatch, sbatchText));
  }

  await Promise.all(writes);

  console.log(`  ${sym.ok} samplesheet ${c.dim(newState.samplesheet)}`);
  if (decisions.sbatch) console.log(`  ${sym.ok} sbatch      ${c.dim(newState.sbatch)}`);
  console.log(`  ${sym.ok} state dir   ${c.dim(newState.stateDir)}`);
  console.log('');
  console.log(c.brand(`${sym.ok} next`));
  if (decisions.sbatch) console.log(`  ${c.cyan('sbatch')} ${newState.sbatch}`);
  console.log(`  ${c.dim('or:')}     ${c.cyan('demux run')} ${newState.base}`);
  console.log('');
}

async function loadPaths(stateDir) {
  try {
    return await existingStateDir(stateDir);
  } catch {
    throw new DemuxError(`No .demux state dir found in ${stateDir}`, {
      code: 'E_NO_STATE',
      hint: 'Point at a directory created by `demux init` or `demux rescue`.',
    });
  }
}

async function nextFixName(prevBase) {
  const baseName = prevBase.replace(/\/+$/, '');
  for (let i = 1; i < 100; i++) {
    const candidate = `${baseName}-fixed-${i}`;
    try {
      const fs = await import('node:fs/promises');
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Too many fix attempts — stopping at 99');
}
