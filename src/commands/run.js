import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir, cpus } from 'node:os';

import { existingStateDir } from '../state/statedir.js';
import { readDecisions } from '../state/decisions.js';
import { parseTopUnknown } from '../parsers/topunknown.js';
import { parseSampleSheet } from '../parsers/samplesheet.js';
import { loadKits, detectKit, detectKitFromUnknowns } from '../core/kits-10x.js';
import { confirm } from '../ui/prompts.js';
import { c, sym, header } from '../ui/theme.js';
import { DemuxError } from '../ui/errors.js';
import { readFile } from 'node:fs/promises';

const FALLBACK_BCL = '~/bin/bclConvert/usr/bin/bcl-convert';

export async function runRun(stateDir, opts = {}) {
  const paths = await loadPaths(stateDir);
  const decisions = await readDecisions(paths.paths.decisions);

  process.stdout.write(header('demux run', decisions.runId));

  // Priority: --bcl-convert flag → DEMUX_BCL_CONVERT env → decisions.json → fallback
  const bclSource = opts.bclConvert
    || process.env.DEMUX_BCL_CONVERT
    || decisions.bclConvert?.path
    || FALLBACK_BCL;
  const bclPath = expandHome(bclSource);
  await ensureExists(bclPath);
  if (decisions.bclConvert?.path && bclSource !== decisions.bclConvert.path) {
    console.log(`  ${sym.warn} overriding decisions bcl-convert (${c.dim(decisions.bclConvert.path)}) with ${c.bold(bclPath)}`);
  } else {
    console.log(`  ${sym.info} using ${c.bold(bclPath)}${decisions.bclConvert?.version ? c.muted(` (v${decisions.bclConvert.version})`) : ''}`);
  }

  await handleExistingOutput(paths.outputDir, opts);

  const threads = String(opts.threads ?? process.env.SLURM_CPUS_PER_TASK ?? Math.max(1, cpus().length - 1));
  const args = [
    '--bcl-input-directory', decisions.rundir,
    '--output-directory', paths.outputDir,
    '--sample-sheet', paths.samplesheet,
    '--bcl-num-conversion-threads', threads,
    '--bcl-num-compression-threads', threads,
  ];

  console.log(`${sym.info} ${c.dim('command:')}`);
  console.log(`  ${c.muted(bclPath)} ${c.muted(args.join(' '))}`);
  console.log('');
  console.log(c.brand(`${sym.info} running bcl-convert (foreground, tee'd to logs)`));
  console.log('');

  const stdoutLog = createWriteStream(paths.paths.bclStdout);
  const stderrLog = createWriteStream(paths.paths.bclStderr);
  const t0 = Date.now();

  const child = spawn(bclPath, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { process.stdout.write(d); stdoutLog.write(d); });
  child.stderr.on('data', (d) => { process.stderr.write(d); stderrLog.write(d); });

  const onSigint = () => {
    console.log(`\n${sym.warn} caught Ctrl-C; forwarding to bcl-convert…`);
    child.kill('SIGINT');
  };
  process.on('SIGINT', onSigint);

  const code = await new Promise((resolve) => child.on('close', resolve));
  process.off('SIGINT', onSigint);

  await Promise.all([
    new Promise((r) => stdoutLog.end(r)),
    new Promise((r) => stderrLog.end(r)),
  ]);

  const dt = formatDuration(Date.now() - t0);
  console.log('');
  if (code === 0) {
    console.log(`${sym.ok} ${c.bold('bcl-convert finished')} ${c.dim(`(${dt})`)}`);
    console.log(`  ${c.dim('output:')} ${paths.outputDir}`);
    console.log(`  ${c.dim('logs:')}   ${paths.paths.bclStdout}`);
    console.log('');
    await suggestKitFixIfMismatched(paths).catch(() => {});
    console.log(`${sym.info} ${c.dim('rescue if needed:')} ${c.cyan('demux rescue')} ${paths.base}`);
  } else {
    console.log(`${sym.err} ${c.bold(`bcl-convert exited with code ${code}`)} ${c.dim(`(${dt})`)}`);
    console.log(`  ${c.dim('stderr:')} ${paths.paths.bclStderr}`);
    process.exit(code);
  }
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

async function ensureExists(path) {
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new DemuxError(`bcl-convert not found or not executable: ${path}`, {
      code: 'E_NO_BCL',
      hint: 'Pass --bcl-convert /path/to/bcl-convert, or fix the default in the tool.',
    });
  }
}

async function handleExistingOutput(outputDir, opts) {
  if (!existsSync(outputDir)) return;
  if (opts.force) {
    console.log(`${sym.warn} removing existing ${outputDir} (--force)`);
    await rm(outputDir, { recursive: true, force: true });
    return;
  }
  console.log(`${sym.warn} output dir already exists: ${c.bold(outputDir)}`);
  const proceed = await confirm('Delete it and continue?', { default: false });
  if (!proceed) {
    throw new DemuxError('aborted — output directory exists', {
      code: 'E_OUTPUT_EXISTS',
      hint: `Either remove it manually (rm -rf ${outputDir}) or re-run with --force.`,
    });
  }
  await rm(outputDir, { recursive: true, force: true });
}

function expandHome(p) {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

async function suggestKitFixIfMismatched(paths) {
  // Look for Reports/TopUnknownBarcodes.csv next to the output dir.
  const topPath = join(paths.outputDir, 'Reports', 'TopUnknownBarcodes.csv');
  let topText;
  try {
    topText = await readFile(topPath, 'utf-8');
  } catch {
    return; // no top-unknown report → nothing to suggest
  }
  const top = parseTopUnknown(topText);
  if (top.length === 0) return;

  await loadKits();
  const sheetText = await readFile(paths.samplesheet, 'utf-8');
  const sheet = parseSampleSheet(sheetText);
  const sheetKit = detectKit(sheet.data)[0] ?? null;
  const unknownKit = detectKitFromUnknowns(top, { topN: 100 })[0] ?? null;

  if (!unknownKit) return;
  if (sheetKit && sheetKit.id === unknownKit.id && sheetKit.workflow === unknownKit.workflow) return;
  if (unknownKit.readsMatched < 1000) return; // not enough signal

  console.log(`${sym.warn} ${c.bold('top unknown barcodes fingerprint as a different 10x kit:')}`);
  console.log(`  ${c.dim('samplesheet kit:')}  ${sheetKit ? `${c.bold(sheetKit.id)} workflow ${sheetKit.workflow}` : c.dim('(none detected)')}`);
  console.log(`  ${c.dim('unknown reads kit:')} ${c.bold(unknownKit.id)} workflow ${unknownKit.workflow}  ${c.muted(`(${unknownKit.readsMatched.toLocaleString()} reads, ${unknownKit.wellCount} wells)`)}`);
  if (sheetKit) {
    console.log(`  ${c.cyan('fix:')} ${c.cyan('demux fix-indices')} ${paths.base} ${c.dim(`--from-kit ${sheetKit.id} --to-kit ${unknownKit.id}`)}`);
  }
  console.log('');
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m${rem}s`;
}
