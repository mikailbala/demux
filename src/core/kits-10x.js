import { resolveColumns } from './filter.js';

// Loaded lazily via dynamic import so the JSON ships in the bundle.
let _kits = null;
export async function loadKits() {
  if (_kits) return _kits;
  const { default: data } = await import('../data/10x-kits.json', { with: { type: 'json' } });
  _kits = data;
  return _kits;
}

// Synchronous variant once loaded.
export function kitsLoaded() {
  if (!_kits) throw new Error('loadKits() must be awaited before kits() is called');
  return _kits;
}

// Build per-kit fast-lookup maps. Memoized.
let _lookups = null;
function lookups() {
  if (_lookups) return _lookups;
  const kits = kitsLoaded();
  _lookups = {};
  for (const [id, kit] of Object.entries(kits)) {
    const A = new Map(); // "<i7>|<i5_a>" → well
    const B = new Map(); // "<i7>|<i5_b>" → well
    for (const [well, idx] of Object.entries(kit.wells)) {
      A.set(`${idx.i7}|${idx.i5_a}`, well);
      B.set(`${idx.i7}|${idx.i5_b}`, well);
    }
    _lookups[id] = { A, B, kit };
  }
  return _lookups;
}

// Detect which kit and which workflow (A or B) the rows are using.
// Returns the list of candidates sorted by match count (desc), each:
//   { id, name, workflow, matched, total, hits: [{rowIndex, well}, ...], misses: [rowIndex,...] }
export function detectKit(rows) {
  const cols = resolveColumns(rows);
  if (!cols.index || !cols.index2 || rows.length === 0) return [];

  const lk = lookups();
  const candidates = [];
  for (const [id, { A, B, kit }] of Object.entries(lk)) {
    for (const [workflow, map] of [['A', A], ['B', B]]) {
      const hits = [];
      const misses = [];
      rows.forEach((r, i) => {
        const i7 = String(r[cols.index] ?? '').toUpperCase();
        const i5 = String(r[cols.index2] ?? '').toUpperCase();
        const well = map.get(`${i7}|${i5}`);
        if (well) hits.push({ rowIndex: i, well });
        else misses.push(i);
      });
      if (hits.length === 0) continue;
      candidates.push({
        id,
        name: kit.name,
        workflow,
        matched: hits.length,
        total: rows.length,
        hits,
        misses,
      });
    }
  }
  candidates.sort((a, b) => b.matched - a.matched);
  return candidates;
}

// Like detectKit but only returns the best match (or null if nothing scored).
export function bestKit(rows) {
  return detectKit(rows)[0] ?? null;
}

// Swap rows from one kit to another, preserving well positions.
// Behavior:
//   - For each row, look up the well in `fromKit`.
//   - Replace its index/index2 with `toKit`'s sequences for the same well.
//   - workflow: which i5 variant to read from fromKit ('A' or 'B'). default: detect.
//   - targetWorkflow: which i5 variant to write into toKit. default: same as workflow.
//   - Unmatched rows are returned unchanged + collected in `unmatched`.
export function swapKit(rows, { fromKit, toKit, workflow, targetWorkflow }) {
  const cols = resolveColumns(rows);
  if (!cols.index || !cols.index2) {
    throw new Error('swapKit: rows have no index/index2 columns');
  }
  const kits = kitsLoaded();
  if (!kits[fromKit]) throw new Error(`unknown source kit: ${fromKit}`);
  if (!kits[toKit]) throw new Error(`unknown target kit: ${toKit}`);

  const lk = lookups();
  const map = lk[fromKit][workflow === 'B' ? 'B' : 'A'];
  const tgt = kits[toKit].wells;
  const tgtField = (targetWorkflow ?? workflow ?? 'A') === 'B' ? 'i5_b' : 'i5_a';

  const out = [];
  const swapped = [];
  const unmatched = [];
  rows.forEach((r, i) => {
    const i7 = String(r[cols.index] ?? '').toUpperCase();
    const i5 = String(r[cols.index2] ?? '').toUpperCase();
    const well = map.get(`${i7}|${i5}`);
    if (!well || !tgt[well]) {
      unmatched.push({ rowIndex: i, sampleId: cols.sampleId ? r[cols.sampleId] : null });
      out.push(r);
      return;
    }
    const next = { ...r };
    next[cols.index] = tgt[well].i7;
    next[cols.index2] = tgt[well][tgtField];
    out.push(next);
    swapped.push({ rowIndex: i, sampleId: cols.sampleId ? r[cols.sampleId] : null, well });
  });
  return { rows: out, swapped, unmatched };
}

// Returns the inferred workflow ('A' or 'B') and well for a given (i7, i5) under a given kit.
// Useful for inline lookups in the UI.
export function lookupWell(kitId, i7, i5) {
  const lk = lookups();
  if (!lk[kitId]) return null;
  const a = lk[kitId].A.get(`${i7}|${i5}`);
  if (a) return { workflow: 'A', well: a };
  const b = lk[kitId].B.get(`${i7}|${i5}`);
  if (b) return { workflow: 'B', well: b };
  return null;
}

// Given top-unknown rows (from parseTopUnknown), see whether they fingerprint
// against any known kit. Returns same shape as detectKit, but operating on the
// raw {index, index2, reads} rows.
export function detectKitFromUnknowns(unknownRows, { topN = 100, minReads = 0 } = {}) {
  if (!unknownRows || unknownRows.length === 0) return [];
  const lk = lookups();
  const sample = [...unknownRows]
    .filter((r) => r.reads >= minReads)
    .sort((a, b) => (b.reads || 0) - (a.reads || 0))
    .slice(0, topN);

  const candidates = [];
  for (const [id, { A, B, kit }] of Object.entries(lk)) {
    for (const [workflow, map] of [['A', A], ['B', B]]) {
      let matched = 0;
      let readsMatched = 0;
      const wells = new Set();
      for (const u of sample) {
        const key = `${(u.index || '').toUpperCase()}|${(u.index2 || '').toUpperCase()}`;
        const well = map.get(key);
        if (well) {
          matched++;
          readsMatched += u.reads || 0;
          wells.add(well);
        }
      }
      if (matched === 0) continue;
      candidates.push({
        id,
        name: kit.name,
        workflow,
        matched,
        sampled: sample.length,
        readsMatched,
        wellCount: wells.size,
      });
    }
  }
  candidates.sort((a, b) => b.readsMatched - a.readsMatched);
  return candidates;
}

export function listKits() {
  return Object.entries(kitsLoaded()).map(([id, k]) => ({
    id,
    name: k.name,
    pn: k.pn,
    wellCount: Object.keys(k.wells).length,
  }));
}
