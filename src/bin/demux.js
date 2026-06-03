import { Command } from 'commander';
import { runInit } from '../commands/init.js';
import { runRescue } from '../commands/rescue.js';
import { runStatus } from '../commands/status.js';
import { runRun } from '../commands/run.js';
import { formatError } from '../ui/errors.js';
import { c } from '../ui/theme.js';

// Replaced at build time by esbuild's `define` (see build.mjs).
// For `node src/bin/demux.js` (dev mode), falls back to reading package.json.
const VERSION = typeof __DEMUX_VERSION__ !== 'undefined'
  ? __DEMUX_VERSION__
  : (await import('node:fs/promises'))
      .then((fs) => fs.readFile(new URL('../../package.json', import.meta.url), 'utf-8'))
      .then((s) => JSON.parse(s).version)
      .catch(() => '0.0.0-dev');

const program = new Command();

program
  .name('demux')
  .description('Interactive CLI for Illumina BCL-convert demultiplexing on HPC')
  .version(VERSION);

program
  .command('init')
  .description('Fresh demux: filter samples, choose cycles/RC, optionally rescue, emit samplesheet + sbatch (or --run inline)')
  .argument('<rundir>', 'path to the Illumina run directory (contains RunInfo.xml + SampleSheet.csv)')
  .option('-s, --samplesheet <path>', 'override samplesheet path (defaults to <rundir>/SampleSheet.csv)')
  .option('-u, --top-unknown <path>', 'TopUnknownBarcodes.csv from a prior demux, for inline rescue')
  .option('-n, --match-len <n>', 'prefix-match length for rescue (default 8)', (v) => parseInt(v, 10))
  .option('--run', 'after generating the samplesheet, run bcl-convert inline instead of emitting sbatch')
  .option('--threads <n>', 'thread count for inline run (default: $SLURM_CPUS_PER_TASK or nproc-1)', (v) => parseInt(v, 10))
  .option('--bcl-convert <path>', 'override path to bcl-convert binary')
  .option('--force', 'when --run is set, delete an existing output dir without prompting')
  .option('--drop-settings <list>', 'comma-separated BCLConvert_Settings keys to strip (in addition to the built-in known-bad list)')
  .option('--keep-all-settings', 'do not strip any unsupported BCLConvert_Settings (default: strip known-bad keys)')
  .action(async (rundir, opts) => {
    try { await runInit(rundir, opts); } catch (e) { fail(e); }
  });

program
  .command('rescue')
  .description('Re-run after first demux: prefix-match against TopUnknownBarcodes.csv and substitute indices')
  .argument('<prev-run-dir>', 'a directory created by `demux init` (contains .demux/ + demux_out/)')
  .option('-u, --top-unknown <path>', 'override TopUnknownBarcodes.csv path')
  .option('-n, --match-len <n>', 'prefix-match length (default: same as prev run)', (v) => parseInt(v, 10))
  .option('--run', 'after generating, run bcl-convert inline instead of emitting sbatch')
  .option('--threads <n>', 'thread count for inline run', (v) => parseInt(v, 10))
  .option('--bcl-convert <path>', 'override path to bcl-convert binary')
  .option('--force', 'when --run is set, delete an existing output dir without prompting')
  .action(async (prev, opts) => {
    try { await runRescue(prev, opts); } catch (e) { fail(e); }
  });

program
  .command('run')
  .description('Run bcl-convert inline against an existing state dir (tee output to .demux/bcl-convert.*.log)')
  .argument('<run-dir>', 'a directory created by `demux init` or `demux rescue`')
  .option('--threads <n>', 'thread count (default: $SLURM_CPUS_PER_TASK or nproc-1)', (v) => parseInt(v, 10))
  .option('--bcl-convert <path>', 'override path to bcl-convert binary')
  .option('--force', 'delete an existing output dir without prompting')
  .action(async (dir, opts) => {
    try { await runRun(dir, opts); } catch (e) { fail(e); }
  });

program
  .command('status')
  .description('Print the decisions and artifact paths for an existing run state dir')
  .argument('<run-dir>', 'a directory created by `demux init` or `demux rescue`')
  .action(async (dir) => {
    try { await runStatus(dir); } catch (e) { fail(e); }
  });

program.showHelpAfterError(c.dim('(run `demux --help` for usage)'));

function fail(err) {
  console.error('');
  console.error(formatError(err));
  console.error('');
  process.exit(1);
}

await program.parseAsync(process.argv);
