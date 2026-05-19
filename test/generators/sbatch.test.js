import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSbatch } from '../../src/generators/sbatch.js';

test('renders required SLURM directives', () => {
  const out = renderSbatch({
    JOB_TAG: 'my-run',
    RUNDIR: '/data/rundir',
    OUTPUT_DIR: '/work/out',
    SAMPLESHEET: '/work/ss.csv',
    STATE_DIR: '/work/state',
    PARTITION: 'compute',
    ACCOUNT: 'mylab',
  });
  assert.match(out, /#SBATCH --job-name=demux-my-run/);
  assert.match(out, /#SBATCH --partition=compute/);
  assert.match(out, /#SBATCH --account=mylab/);
  assert.match(out, /--bcl-input-directory \/data\/rundir/);
  assert.match(out, /--output-directory \/work\/out/);
  assert.match(out, /--sample-sheet \/work\/ss.csv/);
});

test('omits partition/account lines when not provided', () => {
  const out = renderSbatch({
    JOB_TAG: 'my-run',
    RUNDIR: '/data/rundir',
    OUTPUT_DIR: '/work/out',
    SAMPLESHEET: '/work/ss.csv',
    STATE_DIR: '/work/state',
  });
  assert.doesNotMatch(out, /--partition=/);
  assert.doesNotMatch(out, /--account=/);
});

test('preserves SLURM env-var references with defaults', () => {
  const out = renderSbatch({
    JOB_TAG: 'r',
    RUNDIR: 'a',
    OUTPUT_DIR: 'b',
    SAMPLESHEET: 'c',
    STATE_DIR: 'd',
  });
  assert.match(out, /\$\{SLURM_CPUS_PER_TASK:-8\}/);
  assert.match(out, /\$\{SLURM_CPUS_PER_TASK:-unknown\}/);
});

test('uses defaults for CPUS/MEM/WALLTIME when absent', () => {
  const out = renderSbatch({ JOB_TAG: 'r', RUNDIR: 'a', OUTPUT_DIR: 'b', SAMPLESHEET: 'c', STATE_DIR: 'd' });
  assert.match(out, /--cpus-per-task=32/);
  assert.match(out, /--mem=240G/);
  assert.match(out, /--time=12:00:00/);
});

test('includes output-dir-exists guard', () => {
  const out = renderSbatch({ JOB_TAG: 'r', RUNDIR: 'a', OUTPUT_DIR: '/work/out', SAMPLESHEET: 'c', STATE_DIR: 'd' });
  assert.match(out, /if \[ -e "\/work\/out" \]; then/);
  assert.match(out, /already exists from a previous run/);
  assert.match(out, /exit 1/);
});
