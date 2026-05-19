import { c, sym } from './theme.js';

export class DemuxError extends Error {
  constructor(message, { context = [], hint = null, code = 'E_DEMUX' } = {}) {
    super(message);
    this.code = code;
    this.context = context;
    this.hint = hint;
  }
}

export function formatError(err) {
  const lines = [];
  if (err instanceof DemuxError) {
    lines.push(`${sym.err} ${c.bold(err.message)}`);
    for (const ctx of err.context) {
      lines.push(`  ${c.dim('·')} ${ctx}`);
    }
    if (err.hint) {
      lines.push('');
      lines.push(`  ${c.cyan('next:')} ${err.hint}`);
    }
  } else {
    lines.push(`${sym.err} ${c.bold(err.message ?? String(err))}`);
    if (err.stack && process.env.DEMUX_DEBUG) {
      lines.push(c.dim(err.stack));
    }
  }
  return lines.join('\n');
}

export const errors = {
  missingRunInfo: (rundir, found) =>
    new DemuxError(`RunInfo.xml not found in ${rundir}`, {
      code: 'E_NO_RUNINFO',
      context: [
        `Looked for: ${rundir}/RunInfo.xml`,
        found.length ? `Found in dir: ${found.slice(0, 8).join(', ')}${found.length > 8 ? ', …' : ''}` : 'Directory is empty or unreadable',
      ],
      hint: 'Point at the top of an Illumina run directory (the one containing RunInfo.xml + SampleSheet.csv + Data/).',
    }),

  missingSampleSheet: (rundir) =>
    new DemuxError(`SampleSheet.csv not found in ${rundir}`, {
      code: 'E_NO_SAMPLESHEET',
      hint: 'If your samplesheet is named differently, pass `--samplesheet <path>`.',
    }),

  duplicateSampleIds: (dupes) =>
    new DemuxError(`Duplicate (Lane, Sample_ID) pairs in filtered set (${dupes.length})`, {
      code: 'E_DUP_IDS',
      context: dupes.slice(0, 5).map(({ id, lane, rows }) => `${lane != null ? `lane ${lane} / ` : ''}${id} → rows ${rows.join(', ')}`),
      hint: 'Same Sample_ID on different lanes is fine; this means the same ID appears on the SAME lane more than once. Edit the source samplesheet.',
    }),

  illegalSampleIdChars: (offenders) =>
    new DemuxError(`Sample_IDs contain illegal characters for bcl-convert`, {
      code: 'E_BAD_CHARS',
      context: offenders.slice(0, 5).map((o) => `"${o.id}" → suggest "${o.sanitized}"`),
      hint: 'bcl-convert requires Sample_IDs to be alphanumeric, underscore, or hyphen. Edit the sheet or accept the suggestions.',
    }),

  indexCycleMismatch: ({ idx, declared, found }) =>
    new DemuxError(`Index${idx} length doesn't match RunInfo cycle count`, {
      code: 'E_CYCLE_MISMATCH',
      context: [`RunInfo declares ${declared} cycles for Index${idx}`, `Samplesheet has ${found}bp`],
      hint: 'Either provide OverrideCycles (e.g. add `N` padding), or fix the index column length.',
    }),

  noTopUnknown: (path) =>
    new DemuxError(`TopUnknownBarcodes.csv not found`, {
      code: 'E_NO_TOPUNKNOWN',
      context: [`Looked for: ${path}`],
      hint: 'bcl-convert must have completed and produced Reports/. If `--no-reports` was set, re-run without it.',
    }),
};

export function detectDuplicateIds(rows, sampleIdCol, laneCol = null) {
  const byKey = new Map();
  rows.forEach((r, idx) => {
    const id = r[sampleIdCol];
    if (!id) return;
    const lane = laneCol ? String(r[laneCol] ?? '').trim() : '';
    const key = laneCol ? `${lane}\t${id}` : id;
    if (!byKey.has(key)) byKey.set(key, { id, lane: laneCol ? lane : null, rows: [] });
    byKey.get(key).rows.push(idx + 1);
  });
  const dupes = [];
  for (const entry of byKey.values()) {
    if (entry.rows.length > 1) dupes.push(entry);
  }
  return dupes;
}

const ILLEGAL = /[^A-Za-z0-9_-]/;
export function detectIllegalIds(rows, sampleIdCol) {
  const offenders = [];
  for (const r of rows) {
    const id = String(r[sampleIdCol] ?? '');
    if (ILLEGAL.test(id)) {
      offenders.push({
        id,
        sanitized: id.replace(/[^A-Za-z0-9_-]+/g, '_'),
      });
    }
  }
  return offenders;
}
