import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
});

export function parseRunInfo(xmlText) {
  const doc = parser.parse(xmlText);
  const run = doc?.RunInfo?.Run;
  if (!run) {
    throw new Error('RunInfo.xml has no <Run> element');
  }

  const reads = toArray(run.Reads?.Read).map((r) => ({
    number: Number(r.Number),
    cycles: Number(r.NumCycles),
    isIndex: r.IsIndexedRead === 'Y' || r.IsIndexedRead === true,
  }));

  const layout = run.FlowcellLayout || {};

  return {
    runId: run.Id ?? '',
    number: run.Number ?? '',
    flowcell: run.Flowcell ?? '',
    instrument: run.Instrument ?? '',
    date: run.Date ?? '',
    reads,
    lanes: Number(layout.LaneCount ?? 1),
  };
}

export function cyclesString(runInfo) {
  return runInfo.reads
    .map((r) => `${r.isIndex ? 'I' : 'Y'}${r.cycles}`)
    .join(';');
}

export function isDualIndexed(runInfo) {
  return runInfo.reads.filter((r) => r.isIndex).length >= 2;
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
