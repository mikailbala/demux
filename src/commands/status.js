import { resolve } from 'node:path';
import columnify from 'columnify';

import { existingStateDir } from '../state/statedir.js';
import { readDecisions } from '../state/decisions.js';
import { c, sym, header } from '../ui/theme.js';
import { DemuxError } from '../ui/errors.js';

export async function runStatus(dir) {
  const abs = resolve(dir);
  let paths;
  try {
    paths = await existingStateDir(abs);
  } catch {
    throw new DemuxError(`No .demux state dir found in ${abs}`, {
      code: 'E_NO_STATE',
      hint: 'Point at a directory created by `demux init` or `demux rescue`.',
    });
  }
  const dec = await readDecisions(paths.paths.decisions);

  process.stdout.write(header('demux status', dec.runId));

  const overrideDisplay = dec.perLaneOverrideCycles
    ? c.dim(`(per-lane in [Data]; ${dec.perLaneOverrideCycles.length} variant(s))`)
    : dec.overrideCycles || c.dim('(none)');

  const summary = {
    Command: dec.command,
    'Run ID': dec.runId,
    'Run dir': dec.rundir,
    'Generated at': dec.timestamp,
    'bcl-convert': dec.bclConvert ? `${dec.bclConvert.path}  ${c.dim(`(v${dec.bclConvert.version ?? '?'})`)}` : c.dim('(not recorded)'),
    'Override cycles': overrideDisplay,
    'RC i7': dec.reverseComplement?.i7 ? c.ok('yes') : c.dim('no'),
    'RC i5': dec.reverseComplement?.i5 ? c.ok('yes') : c.dim('no'),
    Filter: formatFilter(dec.filterCriteria),
    Rescue: dec.rescue ? `applied=${dec.rescue.applied} N=${dec.rescue.matchLen}` : c.dim('(none)'),
    'Stripped settings': dec.strippedSettings?.length ? dec.strippedSettings.join(', ') : c.dim('(none)'),
    Samplesheet: paths.samplesheet,
    Sbatch: paths.sbatch,
    'Output dir': paths.outputDir,
  };
  if (dec.derivedFrom) summary['Derived from'] = dec.derivedFrom;

  const rows = Object.entries(summary).map(([k, v]) => ({
    key: c.label(k),
    value: String(v),
  }));
  console.log(columnify(rows, {
    showHeaders: false,
    columnSplitter: '  ',
    config: { key: { minWidth: 18 } },
  }));
  console.log('');
  console.log(`${sym.info} run with: ${c.cyan('sbatch')} ${paths.sbatch}`);
  console.log('');
}

function formatFilter(crit) {
  if (!crit) return c.dim('(none)');
  const parts = [];
  if (crit.lanes?.length) parts.push(`lanes=[${crit.lanes.join(',')}]`);
  if (crit.regex) parts.push(`regex=/${crit.regex}/`);
  if (crit.idList?.length) parts.push(`ids=${crit.idList.length}`);
  return parts.length ? parts.join(' ') : c.dim('(none)');
}
