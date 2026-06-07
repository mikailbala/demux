// Dev-time script: parse 10x dual-index kit CSVs into src/data/10x-kits.json.
// Run after dropping new CSVs in (or updating existing ones).
//
//   node scripts/build-10x-kits.mjs [path/to/csvs/dir]
//
// CSV format (from 10x Genomics / Cell Ranger docs):
//   index_name,index(i7),index2_workflow_a(i5),index2_workflow_b(i5)
//   SI-TT-A1,GTAACATGCG,AGTGTTACCT,AGGTAACACT
//   ...
//
// The kit short-id (e.g. "TT-A") is derived from the filename pattern
// `Dual_Index_Kit_<short>_Set_<set>.csv` → `<short>-<set>`.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const DEFAULT_DIRS = [
  '/Users/balami/Desktop/demux_260604',
  'kits',
  '.',
];

// Known PNs — best-effort lookup. Override as needed.
const KNOWN_PNS = {
  'TT-A': ['1000215', '3000431'],
  'TT-B': ['1000252'],
  'TT-C': ['1000253'],
  'TT-D': ['1000254'],
  'NN-A': ['1000243'],
  'NN-B': ['1000244'],
  'NT-A': ['1000242'],
  'NT-B': ['1000245'],
  'TN-A': ['1000250'],
  'TS-A': ['1000251'],
  'TS-B': ['1000249'],
};

const KIT_FAMILY_NAME = {
  TT: "Single Cell 3' Dual Index Kit TT",
  NN: "Single Cell 3' Dual Index Kit NN",
  NT: "Single Cell 3' Dual Index Kit NT",
  TN: "Single Cell 3' Dual Index Kit TN",
  TS: "Single Cell 3' Dual Index Kit TS",
};

const FILE_RE = /^Dual_Index_Kit_([A-Z]+)_Set_([A-Z])\.csv$/i;

async function findCsvDir() {
  const argDir = process.argv[2];
  const candidates = argDir ? [argDir, ...DEFAULT_DIRS] : DEFAULT_DIRS;
  for (const d of candidates) {
    try {
      const entries = await readdir(d);
      if (entries.some((e) => FILE_RE.test(e))) return d;
    } catch {}
  }
  throw new Error(`No directory with Dual_Index_Kit_*.csv files found. Tried: ${candidates.join(', ')}`);
}

const dir = await findCsvDir();
console.log(`reading kit CSVs from ${dir}`);

const entries = (await readdir(dir)).filter((e) => FILE_RE.test(e));
const kits = {};

for (const fname of entries) {
  const m = fname.match(FILE_RE);
  const family = m[1].toUpperCase();
  const set = m[2].toUpperCase();
  const id = `${family}-${set}`;

  const text = await readFile(join(dir, fname), 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  // first non-comment line is the header
  const header = lines.shift();
  if (!/^index_name/i.test(header)) {
    console.warn(`  ! ${fname}: unexpected header "${header}"; skipping`);
    continue;
  }

  const wells = {};
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 4) continue;
    const [name, i7, i5_a, i5_b] = cols;
    const wm = name.match(/^SI-[A-Z]+-([A-H](?:1[0-2]|[1-9]))$/);
    if (!wm) continue;
    wells[wm[1]] = { i7, i5_a, i5_b };
  }

  if (Object.keys(wells).length === 0) {
    console.warn(`  ! ${fname}: no wells parsed; skipping`);
    continue;
  }

  kits[id] = {
    name: `${KIT_FAMILY_NAME[family] ?? family} Set ${set}`,
    pn: KNOWN_PNS[id] ?? [],
    wells,
  };
  console.log(`  ✓ ${id}: ${Object.keys(wells).length} wells from ${fname}`);
}

const out = 'src/data/10x-kits.json';
await writeFile(out, JSON.stringify(kits, null, 2) + '\n');
console.log(`\nwrote ${out} (${Object.keys(kits).length} kits)`);
