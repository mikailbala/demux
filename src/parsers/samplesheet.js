import { parse as parseCsv } from 'csv-parse/sync';

const TABULAR_SECTIONS = new Set(['Data', 'BCLConvert_Data', 'Cloud_Data']);

export function parseSampleSheet(text) {
  const stripped = stripBom(text);
  const lines = stripped.split(/\r?\n/);

  const sections = {};
  const order = [];
  let current = null;
  let buffer = [];

  const flush = () => {
    if (!current) return;
    const trimmed = trimTrailingBlanks(buffer);
    sections[current] = {
      rawLines: trimmed,
      decoded: decodeSection(current, trimmed),
    };
    buffer = [];
  };

  for (const line of lines) {
    const header = line.match(/^\[([^\]]+)\]\s*,*\s*$/);
    if (header) {
      flush();
      current = header[1];
      order.push(current);
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  const version = detectVersion(sections, order);
  const dataKey = version === 'v2' ? 'BCLConvert_Data' : 'Data';
  const settingsKey = version === 'v2' ? 'BCLConvert_Settings' : 'Settings';

  return {
    version,
    order,
    sections,
    dataKey,
    settingsKey,
    data: sections[dataKey]?.decoded ?? [],
    raw: text,
  };
}

function decodeSection(name, lines) {
  if (lines.length === 0) return TABULAR_SECTIONS.has(name) ? [] : {};

  if (TABULAR_SECTIONS.has(name)) {
    return parseCsv(lines.join('\n'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  }

  const obj = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const [k, ...rest] = line.split(',');
    if (!k || !k.trim()) continue;
    obj[k.trim()] = rest.join(',').replace(/,+$/, '').trim();
  }
  return obj;
}

function detectVersion(sections, order) {
  if (sections.BCLConvert_Data || sections.BCLConvert_Settings) return 'v2';
  const header = sections.Header?.decoded;
  if (header?.FileFormatVersion) {
    const v = String(header.FileFormatVersion);
    if (v.startsWith('2')) return 'v2';
  }
  return 'v1';
}

function trimTrailingBlanks(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  return lines.slice(0, end);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function findColumn(rows, candidates) {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  for (const c of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}
