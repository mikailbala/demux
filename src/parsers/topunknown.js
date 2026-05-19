import { parse as parseCsv } from 'csv-parse/sync';

export function parseTopUnknown(text) {
  const rows = parseCsv(stripBom(text), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  return rows
    .map((r) => normalizeRow(r))
    .filter((r) => r.index || r.index2);
}

function normalizeRow(r) {
  const keys = Object.keys(r);
  const find = (...candidates) => {
    for (const c of candidates) {
      const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
      if (hit) return r[hit];
    }
    return undefined;
  };

  const reads = Number(find('# Reads', 'Reads', 'Count') ?? 0);
  return {
    lane: numOrNull(find('Lane')),
    index: find('index', 'Index', 'Index1') ?? '',
    index2: find('index2', 'Index2') ?? '',
    reads: Number.isFinite(reads) ? reads : 0,
    pctUnknown: floatOrNull(find('% of Unknown Barcodes', 'PctUnknown')),
    pctAll: floatOrNull(find('% of All Reads', 'PctAll')),
  };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function floatOrNull(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
