import columnify from 'columnify';
import { c, sym } from './theme.js';
import { cyclesString } from '../parsers/runinfo.js';

export function runSummary(runInfo, samplesheet) {
  const dataKey = samplesheet.dataKey;
  const numSamples = samplesheet.data.length;
  const lanes = uniqueLanes(samplesheet.data);

  const fields = {
    'Run ID': runInfo.runId,
    Flowcell: runInfo.flowcell,
    Instrument: runInfo.instrument,
    Date: runInfo.date,
    Lanes: `${runInfo.lanes} (in samplesheet: ${lanes.join(',') || '—'})`,
    Reads: cyclesString(runInfo),
    'Samplesheet version': samplesheet.version,
    'Data section': dataKey,
    Samples: String(numSamples),
  };

  const rows = Object.entries(fields).map(([k, v]) => ({
    key: c.label(k),
    value: c.muted(String(v)),
  }));

  return columnify(rows, {
    showHeaders: false,
    columnSplitter: '  ',
    config: { key: { minWidth: 22 } },
  });
}

export function filterPreview({ matched, total, sampleIds }) {
  const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '0';
  const head = `${sym.info} ${c.bold(matched)} of ${c.bold(total)} samples match ${c.dim(`(${pct}%)`)}`;
  if (matched === 0) return head;
  const preview = sampleIds.slice(0, 5).map((id) => `  ${c.dim('·')} ${id}`).join('\n');
  const more = sampleIds.length > 5 ? c.dim(`  · …and ${matched - 5} more`) : '';
  return [head, preview, more].filter(Boolean).join('\n');
}

export function samplesheetPreview(rows, n = 10) {
  if (rows.length === 0) return c.dim('(no rows)');
  const slice = rows.slice(0, n);
  return columnify(slice, {
    columnSplitter: '  ',
    config: Object.fromEntries(
      Object.keys(slice[0]).map((k) => [k, { headingTransform: (h) => c.label(h) }]),
    ),
  });
}

function uniqueLanes(rows) {
  const set = new Set();
  for (const r of rows) {
    const l = r.Lane ?? r.lane;
    if (l != null && l !== '') set.add(String(l).trim());
  }
  return [...set].sort();
}
