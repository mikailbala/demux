# demux

Interactive CLI for Illumina BCL-convert demultiplexing on HPC. Walks you through every decision (which samples, which cycles, which indices to reverse-complement, which `bcl-convert` to use, what to rescue from `TopUnknownBarcodes.csv`), produces a clean `SampleSheet.csv` and either an `sbatch` script or an inline `bcl-convert` run.

---

## TL;DR

If you already have demux installed:

```bash
source ~/src/demux-activate
demux init /path/to/illumina/run-dir --run     # inline interactive run
# or omit --run and submit the sbatch yourself:
demux init /path/to/illumina/run-dir
sbatch ./<run-id>/demux.sbatch
```

Pick up an earlier session: `demux status ./<run-id>`. Rescue with `demux rescue ./<run-id>`.

---

## Table of contents

1. [First-time HPC setup](#first-time-hpc-setup)
2. [Per-session activation](#per-session-activation)
3. [Updating demux](#updating-demux)
4. [Commands](#commands)
5. [What `init` actually does](#what-init-actually-does)
6. [bcl-convert: how it's selected](#bcl-convert-how-its-selected)
7. [Override cycles: global vs per-lane](#override-cycles-global-vs-per-lane)
8. [Settings stripping](#settings-stripping)
9. [Index rescue from `TopUnknownBarcodes.csv`](#index-rescue-from-topunknownbarcodescsv)
10. [State directory layout](#state-directory-layout)
11. [Sbatch script](#sbatch-script)
12. [Common errors](#common-errors)
13. [Troubleshooting](#troubleshooting)
14. [Development (laptop side)](#development-laptop-side)
15. [Repo layout](#repo-layout)

---

## First-time HPC setup

Once per user on the HPC. Run on an **interactive node** (Node.js isn't available on login nodes).

### 1. Stage Node 20

```bash
# get an interactive session, whichever your site uses:
srun --pty --time=2:00:00 --mem=4G --cpus-per-task=2 bash

# fetch Node 20.18.0 prebuilt and stash it persistently on $HOME
curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o /tmp/node.tar.xz
mkdir -p /tmp/$USER
tar -xf /tmp/node.tar.xz -C /tmp/$USER
mv /tmp/$USER/node-v20.18.0-linux-x64 /tmp/$USER/demux-node
mkdir -p ~/src
cp -r /tmp/$USER/demux-node ~/src/demux-node-stash
rm /tmp/node.tar.xz
```

Why `/tmp` and a `~/src/demux-node-stash` copy: on Lustre, Node's JIT mmap can fail and `npm` atomic-rename misbehaves. We run from `/tmp` (node-local, fast) and re-stage from the home-dir stash if `/tmp` was wiped between sessions.

### 2. Create the activate script

```bash
cat > ~/src/demux-activate <<'EOF'
# Restage Node from stash if /tmp was wiped
LOCAL_NODE=/tmp/$USER/demux-node
STASH=$HOME/src/demux-node-stash
if [ ! -x "$LOCAL_NODE/bin/node" ]; then
  if [ ! -x "$STASH/bin/node" ]; then
    echo "✖ no Node stash at $STASH — see README 'First-time HPC setup'"
    return 1 2>/dev/null || exit 1
  fi
  mkdir -p "$(dirname "$LOCAL_NODE")"
  cp -r "$STASH" "$LOCAL_NODE"
fi

# npm config off Lustre
export NPM_CONFIG_CACHE=/tmp/$USER/npm-cache
export NPM_CONFIG_PREFIX=/tmp/$USER/demux-npm-prefix
export NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
mkdir -p "$NPM_CONFIG_CACHE" "$NPM_CONFIG_PREFIX"
export PATH="$LOCAL_NODE/bin:$NPM_CONFIG_PREFIX/bin:$PATH"

# Install demux from a release TARBALL (not git+, which has a symlink bug).
#   demux-update            → latest release
#   demux-update v0.2.3     → specific tagged release
demux-update() {
  local ref="${1:-latest}"
  local url
  if [ "$ref" = "latest" ] || [ "$ref" = "main" ]; then
    echo "› resolving latest release…"
    url=$(curl -fsSL "https://api.github.com/repos/mikailbala/demux/releases/latest" \
      | grep -o '"browser_download_url":[[:space:]]*"[^"]*demux-[^"]*\.tgz"' \
      | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
    [ -z "$url" ] && { echo "✖ could not resolve latest release URL"; return 1; }
  else
    local v="${ref#v}"
    url="https://github.com/mikailbala/demux/releases/download/v${v}/demux-${v}.tgz"
  fi
  echo "› downloading $url"
  curl -fsSL "$url" -o /tmp/demux.tgz || { echo "✖ download failed"; return 1; }
  echo "› clearing stale install state…"
  rm -rf "$NPM_CONFIG_PREFIX/lib/node_modules/.demux-"* \
         "$NPM_CONFIG_PREFIX/lib/node_modules/demux" \
         "$NPM_CONFIG_PREFIX/bin/demux"
  echo "› installing from tarball…"
  npm install -g /tmp/demux.tgz --no-audit --no-fund || { echo "✖ npm install failed"; return 1; }
  rm -f /tmp/demux.tgz
  if [ -e "$NPM_CONFIG_PREFIX/lib/node_modules/demux/dist/demux.mjs" ] \
     && [ -x "$NPM_CONFIG_PREFIX/bin/demux" ]; then
    echo "✔ demux $(demux --version) ready"
  else
    echo "✖ install completed but files are missing"
    return 1
  fi
}

# auto-install on first activate (or if a previous install left a dangling symlink)
if ! command -v demux >/dev/null 2>&1 \
   || ! [ -e "$(readlink -f "$(command -v demux 2>/dev/null)")" ]; then
  echo "demux not found (or dangling) — installing latest release…"
  demux-update latest
fi
EOF
```

### 3. Optional: add a shell alias

```bash
echo "alias demux-on='source ~/src/demux-activate'" >> ~/.bashrc
```

Then every new session: `demux-on`.

### 4. First activation

```bash
source ~/src/demux-activate
demux --version
```

---

## Per-session activation

Every new interactive session:

```bash
source ~/src/demux-activate      # or `demux-on` if you set the alias
```

This:
- Restages Node to `/tmp/$USER/demux-node` from `~/src/demux-node-stash` if it's gone.
- Sets `NPM_CONFIG_CACHE` and `NPM_CONFIG_PREFIX` to `/tmp/$USER/...` (Lustre-safe).
- Puts demux on PATH.
- Auto-installs the latest release if `demux` is missing or its symlink is dangling.

No outbound network needed unless `demux` is missing.

---

## Updating demux

```bash
demux-update             # latest GitHub release
demux-update v0.2.5      # specific tagged release
```

The function nukes the existing install, downloads the release tarball, and reinstalls. Always use this — don't run `npm install -g git+...` directly (npm has a bug where it symlinks instead of installing, leaving a dangling link).

---

## Commands

### `demux init <rundir>`

Fresh demux. Walks through every decision; emits a clean `SampleSheet.csv` plus either an `sbatch` script or runs `bcl-convert` inline.

| Flag | Description |
|---|---|
| `<rundir>` (positional) | Path to the Illumina run dir (the one containing `RunInfo.xml` + `SampleSheet.csv`). |
| `-s, --samplesheet <path>` | Use a samplesheet from a different path (defaults to `<rundir>/SampleSheet.csv`). |
| `-u, --top-unknown <path>` | Path to `TopUnknownBarcodes.csv` from a prior demux, for inline index rescue during this `init`. |
| `-n, --match-len <n>` | Prefix-match length for rescue (default `8`). |
| `--run` | After generating the samplesheet, run `bcl-convert` inline (foreground, tee'd to logs) instead of emitting an sbatch script. |
| `--threads <n>` | Threads passed to bcl-convert when `--run` is set. Defaults to `$SLURM_CPUS_PER_TASK` then `nproc-1`. |
| `--bcl-convert <path>` | Explicit path to the `bcl-convert` binary; skips discovery + prompt. Also see `DEMUX_BCL_CONVERT` env var. |
| `--force` | With `--run`, delete an existing `demux_out/` without prompting. |
| `--drop-settings <list>` | Comma-separated additional `[BCLConvert_Settings]` keys to strip from the generated sheet. |
| `--keep-all-settings` | Don't strip any `[BCLConvert_Settings]` keys at all (turns off both built-in known-bad and UMI-conditional stripping). |

Example:

```bash
# basic
demux init /lustre/scratch/runs/250515_LH00954_0008_A23K3HCLT3

# inline run with a specific bcl-convert and 32 threads
demux init /path/to/run --run --bcl-convert ~/bin/bclConvert4.5.4/usr/bin/bcl-convert --threads 32

# strip an extra setting bcl-convert complained about
demux init /path/to/run --drop-settings BarcodeMismatchesIndex1
```

### `demux rescue <prev-run-dir>`

After the first demux, look at `Reports/TopUnknownBarcodes.csv` and rescue samples whose real barcodes drifted from what's in the samplesheet (e.g., index prep error). Reuses the prior run's filter + RC decisions; only asks about substitutions.

| Flag | Description |
|---|---|
| `<prev-run-dir>` (positional) | A directory created by `demux init` (it contains a `.demux/` subdir). |
| `-u, --top-unknown <path>` | Override the auto-discovered TopUnknownBarcodes.csv path. |
| `-n, --match-len <n>` | Prefix-match length (default: same as the prior run). |
| `--run` | Run bcl-convert inline against the new state dir after writing it. |
| `--threads <n>` | Same as `init`. |
| `--bcl-convert <path>` | Same as `init`. |
| `--force` | Same as `init`. |

Output goes to `./<prev-run-id>-rescue-<n>/`.

### `demux run <run-dir>`

Run bcl-convert against an existing state dir (one created by `init` or `rescue`). Tees stdout/stderr to the console **and** to `.demux/bcl-convert.{stdout,stderr}.log`. Forwards Ctrl-C cleanly.

| Flag | Description |
|---|---|
| `<run-dir>` (positional) | A state dir from `init` or `rescue`. |
| `--threads <n>` | Threads. Defaults to `$SLURM_CPUS_PER_TASK` then `nproc-1`. |
| `--bcl-convert <path>` | Override path. Priority: this flag > `DEMUX_BCL_CONVERT` env > the path stored in `.demux/decisions.json` > the built-in fallback `~/bin/bclConvert/usr/bin/bcl-convert`. |
| `--force` | Delete an existing `demux_out/` without prompting. |

Use this for interactive runs (skip the SLURM queue) or to re-run after fixing a samplesheet error without re-going through prompts.

### `demux fix-indices <run-dir>`

When the wet lab ran library X but the techs wrote barcodes from kit Y into the samplesheet (same well numbers, different barcodes), the demux produces 100% Unknown reads. `fix-indices` swaps the barcodes for the same well positions using a bundled 10x kit database.

| Flag | Description |
|---|---|
| `<run-dir>` (positional) | A state dir from `init`/`rescue`. |
| `--from-kit <id>` | Source kit short-id (default: auto-detected from the samplesheet). Available: `TT-A`, `NN-A`, `NT-A` — add more by dropping CSVs in and rebuilding (see `scripts/build-10x-kits.mjs`). |
| `--to-kit <id>` | Target kit short-id. Prompted if omitted. |
| `--workflow <A\|B>` | i5 workflow of the source samplesheet (default: detected). Workflow A = Illumina forward strand; B = reverse complement (NovaSeq X, NextSeq, etc.). |
| `--target-workflow <A\|B>` | i5 workflow to write into the new samplesheet (default: same as source). |
| `-y, --yes` | Skip the confirmation prompt. |

Example — your exact case: samplesheet has NN-A barcodes, library was made with TT-A:

```bash
demux fix-indices ./260507_LH00954_0008_A23K3HCLT3 --to-kit TT-A
# auto-detects NN-A as the source, swaps to TT-A, writes ./260507_LH00954_0008_A23K3HCLT3-fixed-1/
demux run ./260507_LH00954_0008_A23K3HCLT3-fixed-1
```

### 10x kit auto-detection

`demux init` always fingerprints the data section against the bundled kit database and reports:

```
› 10x kit: NN-A workflow A  Single Cell 3' Dual Index Kit NN Set A  ✓ 96/96
```

If `Sample_ID` values encode a different kit (e.g., contain `SI-TT-…` but barcodes match NN), demux prints a `⚠` warning with the suggested `fix-indices` command before continuing.

### Post-run hint

After `demux run` finishes, demux peeks at `Reports/TopUnknownBarcodes.csv`. If the unknown reads fingerprint as a *different* known kit than the samplesheet, you get:

```
⚠ top unknown barcodes fingerprint as a different 10x kit:
  samplesheet kit:   NN-A workflow A
  unknown reads kit: TT-A workflow A  (87,432,109 reads, 16 wells)
  fix: demux fix-indices ./<run-dir> --from-kit NN-A --to-kit TT-A
```

### `demux status <run-dir>`

Print a summary of an existing state dir: command, run ID, bcl-convert binary + version, override cycles (or per-lane variants), RC choices, filter criteria, rescue stats, stripped settings, and key paths.

```bash
demux status ./241015_A00123_0042_AHFJK7DSXY
```

Useful for "where was I" after coming back to a session.

### Global

`demux --version`, `demux --help`, `demux <subcommand> --help` — standard.

---

## What `init` actually does

8 steps, each spelled out as it runs:

1. **Parse RunInfo + SampleSheet.** Validates both exist; reports the run ID, instrument, flowcell, lanes, read cycles, and sample count.
2. **Select bcl-convert.** See [bcl-convert](#bcl-convert-how-its-selected) below. Records path + version into `.demux/decisions.json`.
3. **Sample selection.** Iteratively filter by lane, Sample_ID/Sample_Name regex, and/or explicit Sample_ID list. AND across criteria types, OR within a single list. Shows a running matched count.
4. **Override cycles.** If the samplesheet has per-lane `OverrideCycles` in `[BCLConvert_Data]`, demux auto-removes the global one from `[BCLConvert_Settings]` (bcl-convert errors if both are set). Otherwise prompts whether to override the cycles detected from RunInfo, validating the format on entry.
5. **Reverse complement.** Shows three sample i7 (and i5 if dual-indexed) values side by side with their reverse complements, then asks per-index.
6. **Optional rescue** (only when `--top-unknown` is supplied). See [rescue](#index-rescue-from-topunknownbarcodescsv).
7. **Review.** Prints the final samplesheet preview, the bcl-convert version chosen, and either prompts for sbatch parameters (partition, account, cpus, memory, walltime) or skips them (with `--run`). Asks for final confirmation.
8. **Write artifacts.** Drops the state dir at `./<run-id>/`. If `--run`, hands off to `demux run`.

You can Ctrl-C at any step before step 8 with zero side effects.

---

## bcl-convert: how it's selected

`demux init` discovers candidates and prompts you to confirm. Discovery looks at:

- Any explicit path: `--bcl-convert <path>` or `DEMUX_BCL_CONVERT=/path/...` env.
- `~/bin/bclConvert*/usr/bin/bcl-convert` (the typical local install layout).
- `~/bin/bcl-convert`, `/opt/bcl-convert/bin/bcl-convert`, `/usr/local/bin/bcl-convert`, `/usr/bin/bcl-convert`.
- Whatever's on `PATH`.

For each candidate, demux runs `<path> --version` and parses the version. It reports candidates highest-version-first, and if the samplesheet declares a `SoftwareVersion` (in Header or Settings), flags the matching candidate with `← matches samplesheet`.

If only one is found, demux asks "Use this bcl-convert?" If multiple, you pick. If none, you're prompted for a path.

The chosen `{path, version}` is recorded in `.demux/decisions.json` so subsequent `demux run` invocations use the same binary by default.

**Skip the prompt** in future runs: `export DEMUX_BCL_CONVERT=~/bin/bclConvert4.5.4/usr/bin/bcl-convert` in your activate script, or `demux init ... --bcl-convert <path>`.

---

## Override cycles: global vs per-lane

bcl-convert accepts `OverrideCycles` in two places:

1. **`[BCLConvert_Settings]`** — global, applies to all samples.
2. **Per-row in `[BCLConvert_Data]`** — applies only to that row's lane/sample.

bcl-convert errors if **both** are set (real error: `You cannot specify 'OverrideCycles' setting in both [BCLConvert_Settings] section and [BCLConvert_Data] section`).

demux detects per-lane overrides automatically: if any data row has a non-empty `OverrideCycles` column, demux removes the global one and reports the per-lane variants it kept. You see something like:

```
[4/8] Override cycles
  › per-lane OverrideCycles found in [BCLConvert_Data]:
    · U28;I10;I10;Y90       (84 samples)
    · Y28;I8N2;N2I8;Y50N40  (12 samples)
  (global OverrideCycles will be removed from [BCLConvert_Settings] to avoid conflict)
```

If there are no per-lane overrides, demux suggests the cycles derived from RunInfo (`Y151;I10;I10;Y151` style) and lets you accept or supply your own. Format validator: `Y<n>` / `I<n>` / `N<n>` / `U<n>` segments joined by `;`, e.g. `Y150U6N5;I8;I8;Y150U6N5`.

---

## Settings stripping

bcl-convert silently rejects many keys that other Illumina tooling writes into the samplesheet. demux strips them automatically and tells you what it stripped.

### Always stripped (built-in known-bad list)

- `AutoDetectDemuxMode`
- `FastqcDownsampling`

### Conditionally stripped

| Key | Condition |
|---|---|
| `OverrideCycles` (global) | Removed when any per-lane `OverrideCycles` exists in `[BCLConvert_Data]`. |
| `TrimUMI` | Removed when effective OverrideCycles has no `U<n>` segment. |
| `Read1UMILength`, `Read2UMILength` | Same as `TrimUMI`. |

### Manual overrides

- `--drop-settings KeyA,KeyB,…` — add more keys to strip.
- `--keep-all-settings` — disable all stripping (use only when you're sure all settings are valid for your bcl-convert version).

You'll see something like:

```
⚠ stripping 3 BCLConvert setting(s):
  · AutoDetectDemuxMode = None      (unsupported by bcl-convert)
  · FastqcDownsampling  = false     (unsupported by bcl-convert)
  · TrimUMI             = 1         (requires a U<n> segment in OverrideCycles)
  (pass --keep-all-settings to disable stripping)
```

---

## Index rescue from `TopUnknownBarcodes.csv`

When the first demux has lower-than-expected yield on some samples, the actual sequenced barcodes often appear in `Reports/TopUnknownBarcodes.csv` — frequently with a different suffix than what's in the samplesheet. demux's rescue:

1. For each filtered sample, takes the first `N` bases of its i7 (and i5 if dual-indexed). Default `N = 8`; override with `-n`.
2. Compares against the first `N` of every unknown barcode.
3. Surfaces candidates ranked by read count, with a confidence (% of total unknown reads).
4. You multi-select which substitutions to apply.

There are two ways to trigger rescue:

- **Inline during init**: `demux init <rundir> --top-unknown /path/to/TopUnknownBarcodes.csv`.
- **As a separate pass after the first demux**: `demux rescue ./<run-id>` (auto-discovers `<run-id>/demux_out/Reports/TopUnknownBarcodes.csv`).

`demux rescue` writes a new sibling dir: `./<run-id>-rescue-1/`, `./<run-id>-rescue-2/`, …

---

## State directory layout

Each `demux init` creates `./<run-id>/`:

```
241015_A00123_0042_AHFJK7DSXY/
├── SampleSheet.csv              # final, generated — what bcl-convert reads
├── demux.sbatch                 # ready-to-submit sbatch script (omitted with --run)
└── .demux/
    ├── decisions.json           # everything you chose, with timestamps
    ├── samplesheet.original.csv # verbatim copy of the source
    ├── samplesheet.filtered.csv # filter + RC + substitutions, no OverrideCycles
    ├── samplesheet.final.csv    # same as ../SampleSheet.csv (kept for diff history)
    ├── runinfo.snapshot.json    # parsed RunInfo.xml
    ├── top-unknown.snapshot.csv # only present after rescue
    ├── bcl-convert.stdout.log   # written when sbatch or `demux run` executes
    └── bcl-convert.stderr.log
```

`demux_out/` is **not** pre-created — bcl-convert refuses to overwrite an existing output dir. It's created by bcl-convert when it runs.

### `.demux/decisions.json`

Captures the complete decision state so you can resume / audit / rebuild:

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-05-15T18:21:09.231Z",
  "command": "init",
  "rundir": "/lustre/.../250515_LH00954_0008_A23K3HCLT3",
  "runId": "250515_LH00954_0008_A23K3HCLT3",
  "filterCriteria": { "lanes": ["8"], "regex": null, "idList": [] },
  "overrideCycles": null,
  "perLaneOverrideCycles": [
    { "cycles": "U28;I10;I10;Y90",       "count": 84 },
    { "cycles": "Y28;I8N2;N2I8;Y50N40",  "count": 12 }
  ],
  "reverseComplement": { "i7": false, "i5": true },
  "rescue": null,
  "substitutions": [],
  "sbatch": { "PARTITION": "compute", "ACCOUNT": "mylab", "CPUS": "32", "MEM": "240G", "WALLTIME": "12:00:00" },
  "bclConvert": { "path": "/lustre/.../bin/bclConvert4.5.4/usr/bin/bcl-convert", "version": "4.5.4" },
  "strippedSettings": ["AutoDetectDemuxMode", "FastqcDownsampling", "TrimUMI"]
}
```

`demux status <run-dir>` prints a friendly summary of this file.

---

## Sbatch script

Generated `demux.sbatch` includes a guard that fails fast if `demux_out/` already exists (with a `rm -rf` hint). Resource defaults — adjusted from your prompts during init:

```bash
#SBATCH --cpus-per-task=32
#SBATCH --mem=240G
#SBATCH --time=12:00:00
#SBATCH --ntasks=1
#SBATCH --output=<state-dir>/bcl-convert.stdout.log
#SBATCH --error=<state-dir>/bcl-convert.stderr.log
#SBATCH --partition=<from prompt>
#SBATCH --account=<from prompt>
```

The bcl-convert invocation uses `--bcl-num-conversion-threads $SLURM_CPUS_PER_TASK` and `--bcl-num-compression-threads $SLURM_CPUS_PER_TASK`.

If you'd rather not queue, use `--run` or `demux run` for an interactive foreground execution.

---

## Common errors

demux's errors use a consistent shape: red `✖`, summary, context bullets, "next:" hint. Each error has a code so you can `grep` log files.

| Code | Meaning | Likely fix |
|---|---|---|
| `E_NO_RUNINFO` | `RunInfo.xml` missing from rundir | Point at the *top* of the run dir, not a subdir like `Data/`. |
| `E_NO_SAMPLESHEET` | `SampleSheet.csv` missing | Use `-s /path/to/sheet.csv` if it's named or located differently. |
| `E_DUP_IDS` | Same `Sample_ID` on the same Lane more than once | bcl-convert allows same ID across different lanes, but not within one. Edit the source. |
| `E_BAD_CHARS` | Illegal chars in `Sample_ID` | Sanitize: only `A-Za-z0-9_-`. demux shows the suggested clean form. |
| `E_CYCLE_MISMATCH` | Index length doesn't match RunInfo cycles | Provide `OverrideCycles` or fix the sheet. |
| `E_NO_TOPUNKNOWN` | TopUnknownBarcodes.csv missing | bcl-convert must have completed and not been run with `--no-reports`. |
| `E_EMPTY_FILTER` | Filter resolved to zero samples | Loosen criteria or reset. |
| `E_NO_BCL` | bcl-convert binary not found / not executable | Pass `--bcl-convert <path>` or set `DEMUX_BCL_CONVERT`. |
| `E_BCL_NOT_RUNNABLE` | Explicit bcl-convert path exists but `--version` fails | Wrong arch, missing libs, or not actually bcl-convert. |
| `E_OUTPUT_EXISTS` | `demux_out/` exists during `demux run` | `rm -rf <run-dir>/demux_out` or pass `--force`. |
| `E_NO_STATE` | Tried to `rescue`/`run`/`status` a non-state dir | Point at a dir created by `demux init` (has a `.demux/` subdir). |

When troubleshooting an error, run `DEMUX_DEBUG=1 demux ...` to get a stack trace appended.

---

## Troubleshooting

### `demux: command not found` after install

Almost always either (a) you forgot `source ~/src/demux-activate`, or (b) the previous install left a dangling symlink in `$NPM_CONFIG_PREFIX/bin/`. Fix:

```bash
rm -rf "$NPM_CONFIG_PREFIX/lib/node_modules/.demux-"* \
       "$NPM_CONFIG_PREFIX/lib/node_modules/demux" \
       "$NPM_CONFIG_PREFIX/bin/demux"
demux-update latest
```

### Install reports "added 1 package" but `demux --version` errors

Symptom of npm's `git+` install symlinking instead of copying. Use `demux-update` (which uses the release tarball), not `npm install -g git+...` directly.

### Node segfaults on first run

The prebuilt Node binary doesn't tolerate Lustre's mmap behavior. The stash + `/tmp` restage pattern in the activate script works around this. If it segfaults from `/tmp` too:
- `findmnt /tmp -o OPTIONS` — if it has `noexec`, ask your sysadmins.
- Compile Node from source (`nodeenv --node=20.18.0 --source <path>`) — 20–40 min.
- Use a system module if one exists: `module avail node`.

### bcl-convert errors with "unrecognized setting X"

Add it: `demux init ... --drop-settings X` (you can comma-separate). If you find a setting that should always be stripped, file an issue — the built-in known-bad list is at [src/generators/samplesheet.js](src/generators/samplesheet.js).

### bcl-convert errors with "Cannot specify 'OverrideCycles' in both sections"

demux should catch this. If you see it, you're running a version of demux that predates per-lane handling. Update: `demux-update latest`.

### Different `bcl-convert` versions on different nodes

The selected binary is recorded in `.demux/decisions.json` as an absolute path. If your interactive node and compute nodes have different filesystems, make sure the path you choose is accessible from both. Use a symlink or `module load` to standardize.

### `demux_out/` already exists

bcl-convert refuses to overwrite. Either:
- `rm -rf <run-dir>/demux_out` and re-submit/run.
- Pass `--force` to `demux run` for an inline run (prompts otherwise).

### `/tmp` was wiped between sessions

Expected — activate restages Node from `~/src/demux-node-stash` automatically, and reinstalls demux if missing. The first activate of a session can take 5–10 s while it does both.

### Lustre + npm: `ENOTEMPTY` during install

Stale temp dirs from a half-completed install. `demux-update` clears them before each install — use it instead of raw `npm install`.

---

## Development (laptop side)

If you're modifying demux itself.

```bash
# clone (only on the dev machine, not the HPC)
git clone https://github.com/mikailbala/demux.git
cd demux
npm install

# run from source while iterating
npm run dev -- init /path/to/test-fixtures/some-rundir

# run tests
npm test

# build the single-file bundle (esbuild → dist/demux.mjs)
npm run build
```

### Iteration loop

```bash
$EDITOR src/...
npm run ship      # runs tests, builds dist/, stages dist/
git commit -am "describe change"
git push          # CI runs tests on GitHub
```

To ship a release:

```bash
npm version patch          # bumps package.json + creates a git tag
git push && git push --tags
# CI builds + attaches demux-<ver>.tgz to a GitHub release automatically
```

On HPC then: `demux-update v<ver>` (or just `demux-update` for latest).

### CI

- [.github/workflows/test.yml](.github/workflows/test.yml) — runs `npm test` + `npm run build` on every push to `main` and PR.
- [.github/workflows/release.yml](.github/workflows/release.yml) — on a `v*` tag push, builds + packs + attaches `demux-<ver>.tgz` to a GitHub release.

---

## Repo layout

```
demux/
├── src/
│   ├── bin/demux.js              # CLI entry, commander wiring
│   ├── commands/
│   │   ├── init.js               # the main interactive workflow
│   │   ├── rescue.js             # rescue from TopUnknownBarcodes.csv
│   │   ├── run.js                # inline bcl-convert execution
│   │   └── status.js             # summarize an existing state dir
│   ├── core/                     # pure functions (no I/O) — testable
│   │   ├── bcl-convert.js        # discovery + version parsing
│   │   ├── cycles.js             # OverrideCycles suggestion + validation
│   │   ├── filter.js             # lane / regex / id-list filtering
│   │   ├── rescue.js             # prefix-match + substitution
│   │   └── revcomp.js            # i7/i5 reverse complement
│   ├── generators/
│   │   ├── samplesheet.js        # serialize parsed sheet back to CSV, strip settings
│   │   └── sbatch.js             # render the sbatch template
│   ├── parsers/
│   │   ├── runinfo.js            # RunInfo.xml
│   │   ├── samplesheet.js        # v1 + v2 sectioned format
│   │   └── topunknown.js         # bcl-convert's TopUnknownBarcodes.csv
│   ├── state/
│   │   ├── decisions.js          # read/write decisions.json
│   │   └── statedir.js           # path computation for run state dirs
│   └── ui/
│       ├── theme.js              # chalk palette + symbols
│       ├── prompts.js            # @inquirer/prompts wrappers
│       ├── summary.js            # run summary + filter preview tables
│       ├── candidates.js         # rescue candidates table
│       └── errors.js             # DemuxError shape + formatting
├── test/                          # node:test (no extra runner)
├── dist/demux.mjs                 # built bundle (committed; the published artifact)
├── build.mjs                      # esbuild config
├── package.json
└── .github/workflows/             # CI
```
