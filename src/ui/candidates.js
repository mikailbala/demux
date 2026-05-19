import Table from 'cli-table3';
import { c, sym } from './theme.js';

export function renderCandidatesTable(matches) {
  if (matches.length === 0) {
    return `${sym.warn} No samples had any prefix matches in TopUnknownBarcodes.csv`;
  }

  const table = new Table({
    head: [
      c.label('Sample_ID'),
      c.label('orig i7'),
      c.label('orig i5'),
      c.label('cand i7'),
      c.label('cand i5'),
      c.label('reads'),
      c.label('%unk'),
      c.label('match'),
    ],
    style: { head: [], border: ['gray'] },
    chars: tableChars,
  });

  for (const m of matches) {
    const top = m.candidates[0];
    table.push([
      m.sampleId ?? '',
      m.originalI7,
      m.originalI5 || c.dim('—'),
      colorize(top.unknown.index, m.originalI7),
      m.originalI5 ? colorize(top.unknown.index2 || '', m.originalI5) : c.dim('—'),
      top.reads.toLocaleString(),
      `${(top.confidence * 100).toFixed(2)}%`,
      top.exactMatch ? c.ok('exact') : c.warn('prefix'),
    ]);
    if (m.candidates.length > 1) {
      for (const alt of m.candidates.slice(1, 3)) {
        table.push([
          c.dim('  ↳ alt'),
          '',
          '',
          c.dim(alt.unknown.index),
          c.dim(alt.unknown.index2 || '—'),
          c.dim(alt.reads.toLocaleString()),
          c.dim(`${(alt.confidence * 100).toFixed(2)}%`),
          c.dim(alt.exactMatch ? 'exact' : 'prefix'),
        ]);
      }
    }
  }

  return table.toString();
}

function colorize(candidate, original) {
  if (!candidate) return c.dim('—');
  const len = Math.min(candidate.length, original.length);
  const prefix = candidate.slice(0, len);
  const tail = candidate.slice(len);
  return c.ok(prefix) + (tail ? c.warn(tail) : '');
}

const tableChars = {
  top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
  bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
  left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
  right: '│', 'right-mid': '┤', middle: '│',
};
