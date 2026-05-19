import { resolveColumns } from './filter.js';

const COMP = { A: 'T', T: 'A', C: 'G', G: 'C', N: 'N' };

export function revcomp(seq) {
  if (!seq) return seq;
  const s = String(seq).toUpperCase();
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) {
    const c = COMP[s[i]];
    if (!c) {
      throw new Error(`Cannot reverse-complement '${seq}': invalid base '${s[i]}' at position ${i}`);
    }
    out += c;
  }
  return out;
}

export function applyRC(rows, { i7 = false, i5 = false } = {}) {
  if (!i7 && !i5) return rows;
  const cols = resolveColumns(rows);
  return rows.map((r) => {
    const next = { ...r };
    if (i7 && cols.index && next[cols.index]) {
      next[cols.index] = revcomp(next[cols.index]);
    }
    if (i5 && cols.index2 && next[cols.index2]) {
      next[cols.index2] = revcomp(next[cols.index2]);
    }
    return next;
  });
}

export function previewIndices(rows, n = 3) {
  const cols = resolveColumns(rows);
  const out = [];
  for (const r of rows.slice(0, n)) {
    out.push({
      sampleId: cols.sampleId ? r[cols.sampleId] : '',
      i7: cols.index ? r[cols.index] ?? '' : '',
      i5: cols.index2 ? r[cols.index2] ?? '' : '',
    });
  }
  return out;
}
