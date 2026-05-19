import { resolveColumns } from './filter.js';

export function prefixMatch(rows, topUnknown, { n = 8, dual = true } = {}) {
  const cols = resolveColumns(rows);
  const totalUnknownReads = topUnknown.reduce((s, u) => s + (u.reads || 0), 0);

  const result = [];
  for (const r of rows) {
    const sampleId = cols.sampleId ? r[cols.sampleId] : '';
    const i7 = cols.index ? String(r[cols.index] ?? '') : '';
    const i5 = cols.index2 ? String(r[cols.index2] ?? '') : '';
    if (!i7) continue;

    const px7 = i7.slice(0, n).toUpperCase();
    const px5 = dual && i5 ? i5.slice(0, n).toUpperCase() : null;

    const matches = topUnknown
      .filter((u) => {
        const ux7 = String(u.index || '').slice(0, n).toUpperCase();
        if (ux7 !== px7) return false;
        if (px5 != null) {
          const ux5 = String(u.index2 || '').slice(0, n).toUpperCase();
          if (ux5 !== px5) return false;
        }
        return true;
      })
      .map((u) => ({
        unknown: u,
        reads: u.reads || 0,
        confidence: totalUnknownReads > 0 ? (u.reads || 0) / totalUnknownReads : 0,
        exactMatch: u.index === i7 && (!dual || u.index2 === i5),
      }))
      .sort((a, b) => b.reads - a.reads);

    if (matches.length) {
      result.push({
        sampleId,
        originalRow: r,
        originalI7: i7,
        originalI5: i5,
        candidates: matches,
      });
    }
  }
  return result;
}

export function applySubstitutions(rows, substitutions) {
  // substitutions: Map<sampleId, { newI7, newI5 }>
  const cols = resolveColumns(rows);
  if (!cols.sampleId) return rows;
  return rows.map((r) => {
    const id = r[cols.sampleId];
    const sub = substitutions.get(id);
    if (!sub) return r;
    const next = { ...r };
    if (cols.index && sub.newI7 != null) next[cols.index] = sub.newI7;
    if (cols.index2 && sub.newI5 != null) next[cols.index2] = sub.newI5;
    return next;
  });
}
