import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

const execp = promisify(exec);

const HOME = homedir();

// Patterns to scan when the user doesn't pass an explicit path.
const DIRECT_PATHS = [
  join(HOME, 'bin', 'bcl-convert'),
  '/opt/bcl-convert/bin/bcl-convert',
  '/usr/local/bin/bcl-convert',
  '/usr/bin/bcl-convert',
];

const HOME_BIN_PATTERN = /^bclConvert/i; // matches ~/bin/bclConvert*/usr/bin/bcl-convert

export async function discoverBclConvert(extras = []) {
  const paths = new Set();

  for (const p of extras) {
    if (await isExecutable(p)) paths.add(p);
  }

  // ~/bin/bclConvert*/usr/bin/bcl-convert
  try {
    const entries = await readdir(join(HOME, 'bin'));
    for (const entry of entries) {
      if (!HOME_BIN_PATTERN.test(entry)) continue;
      const candidate = join(HOME, 'bin', entry, 'usr', 'bin', 'bcl-convert');
      if (await isExecutable(candidate)) paths.add(candidate);
    }
  } catch {
    // no ~/bin or unreadable — fine
  }

  for (const p of DIRECT_PATHS) {
    if (await isExecutable(p)) paths.add(p);
  }

  // PATH
  try {
    const { stdout } = await execp('command -v bcl-convert 2>/dev/null || which bcl-convert 2>/dev/null');
    const onPath = stdout.trim();
    if (onPath && (await isExecutable(onPath))) paths.add(onPath);
  } catch {
    // no bcl-convert on PATH — fine
  }

  const results = [];
  for (const path of paths) {
    const version = await getBclVersion(path).catch(() => null);
    results.push({ path, version });
  }

  // Sort: known versions first (highest semver), then unknowns
  results.sort((a, b) => {
    if (a.version && !b.version) return -1;
    if (!a.version && b.version) return 1;
    if (a.version && b.version) return semverCompare(b.version, a.version);
    return a.path.localeCompare(b.path);
  });

  return results;
}

export async function getBclVersion(path) {
  try {
    const { stdout, stderr } = await execp(`"${path}" --version`, { timeout: 5000 });
    return parseBclVersion((stdout || '') + (stderr || ''));
  } catch (e) {
    // bcl-convert sometimes prints --version to stderr and exits non-zero
    if (e.stderr || e.stdout) return parseBclVersion((e.stdout || '') + (e.stderr || ''));
    return null;
  }
}

export function parseBclVersion(text) {
  if (!text) return null;
  // bcl-convert prints things like:
  //   "bcl-convert Version 00.000.000.4.5.4"        (CLI --version, older releases)
  //   "bcl-convert Version 4.5.4"                    (CLI --version, newer)
  //   "bcl-convert 00.000.000.4.5.4"                 (samplesheet SoftwareVersion field)
  // Whatever the prefix, take the trailing 3 dotted segments of the run of digits/dots.
  const labeled = text.match(/bcl-convert[\s:]*(?:Version[\s:]+)?([\d.]+)/i);
  if (labeled) {
    const parts = labeled[1].split('.').filter(Boolean);
    if (parts.length >= 3) return parts.slice(-3).join('.');
  }
  // Generic fallback: any X.Y.Z anywhere.
  const fb = text.match(/(\d+\.\d+\.\d+)/);
  return fb ? fb[1] : null;
}

export function getDeclaredSoftwareVersion(samplesheet) {
  const sources = [
    samplesheet?.sections?.Header?.decoded,
    samplesheet?.sections?.[samplesheet?.settingsKey]?.decoded,
  ];
  const keys = ['SoftwareVersion', 'BCLConvertVersion', 'bcl-convert-version', 'BclConvertVersion'];
  for (const src of sources) {
    if (!src) continue;
    for (const k of Object.keys(src)) {
      if (keys.some((kk) => kk.toLowerCase() === k.toLowerCase())) {
        return parseBclVersion(src[k]) ?? String(src[k]).trim() ?? null;
      }
    }
  }
  return null;
}

export function semverCompare(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function isExecutable(p) {
  try {
    const s = await stat(p);
    if (!s.isFile()) return false;
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
