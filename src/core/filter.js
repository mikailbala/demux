import { findColumn } from '../parsers/samplesheet.js';

export function resolveColumns(rows) {
  return {
    lane: findColumn(rows, ['Lane']),
    sampleId: findColumn(rows, ['Sample_ID', 'SampleID']),
    sampleName: findColumn(rows, ['Sample_Name', 'SampleName']),
    sampleProject: findColumn(rows, ['Sample_Project', 'SampleProject', 'Project']),
    index: findColumn(rows, ['index', 'Index', 'Index1']),
    index2: findColumn(rows, ['index2', 'Index2']),
  };
}

export function applyFilter(rows, criteria) {
  const cols = resolveColumns(rows);
  let out = rows;

  if (criteria.lanes?.length) {
    if (!cols.lane) {
      throw new Error('Cannot filter by lane: Sample sheet has no Lane column');
    }
    const set = new Set(criteria.lanes.map((n) => String(n)));
    out = out.filter((r) => set.has(String(r[cols.lane]).trim()));
  }

  if (criteria.regex) {
    let re;
    try {
      re = new RegExp(criteria.regex);
    } catch (e) {
      throw new Error(`Invalid regex "${criteria.regex}": ${e.message}`);
    }
    out = out.filter((r) => {
      const id = cols.sampleId ? r[cols.sampleId] : '';
      const name = cols.sampleName ? r[cols.sampleName] : '';
      return re.test(id ?? '') || re.test(name ?? '');
    });
  }

  if (criteria.idList?.length) {
    if (!cols.sampleId) {
      throw new Error('Cannot filter by Sample_ID: sheet has no Sample_ID column');
    }
    const set = new Set(criteria.idList.map((s) => s.trim()));
    out = out.filter((r) => set.has(String(r[cols.sampleId]).trim()));
  }

  return out;
}

export function laneOptions(rows) {
  const cols = resolveColumns(rows);
  if (!cols.lane) return [];
  const seen = new Set();
  for (const r of rows) {
    const v = String(r[cols.lane]).trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

export function previewIds(rows, n = 5) {
  const cols = resolveColumns(rows);
  if (!cols.sampleId) return [];
  return rows.slice(0, n).map((r) => r[cols.sampleId]);
}
