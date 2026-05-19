import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

function pathBundle(base) {
  const stateDir = join(base, '.demux');
  return {
    base,
    stateDir,
    outputDir: join(base, 'demux_out'),
    samplesheet: join(base, 'SampleSheet.csv'),
    sbatch: join(base, 'demux.sbatch'),
    paths: {
      decisions: join(stateDir, 'decisions.json'),
      original: join(stateDir, 'samplesheet.original.csv'),
      filtered: join(stateDir, 'samplesheet.filtered.csv'),
      final: join(stateDir, 'samplesheet.final.csv'),
      runinfoSnapshot: join(stateDir, 'runinfo.snapshot.json'),
      topUnknownSnapshot: join(stateDir, 'top-unknown.snapshot.csv'),
      bclStdout: join(stateDir, 'bcl-convert.stdout.log'),
      bclStderr: join(stateDir, 'bcl-convert.stderr.log'),
    },
  };
}

export async function createStateDir(baseName, { cwd = process.cwd() } = {}) {
  const base = resolve(cwd, baseName);
  const b = pathBundle(base);
  // Only create state metadata dir. bcl-convert refuses to run if outputDir exists,
  // so we deliberately don't pre-create it.
  await mkdir(b.stateDir, { recursive: true });
  return b;
}

export async function existingStateDir(path) {
  const base = resolve(path);
  const b = pathBundle(base);
  await access(b.stateDir, constants.R_OK);
  return b;
}

export async function nextRescueName(prevBase) {
  const baseName = prevBase.replace(/\/+$/, '');
  for (let i = 1; i < 100; i++) {
    const candidate = `${baseName}-rescue-${i}`;
    try {
      await access(candidate, constants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error('Too many rescue attempts — stopping at 99');
}

export async function writeText(path, content) {
  await writeFile(path, content);
}

export async function readText(path) {
  return readFile(path, 'utf-8');
}
