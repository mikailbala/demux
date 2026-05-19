# demux

Interactive CLI for Illumina BCL-convert demultiplexing on HPC.

Wraps the judgment-heavy parts of your manual workflow — filtering samples, choosing override cycles, deciding reverse-complement, rescuing missing indices from `TopUnknownBarcodes.csv`, and picking the right `bcl-convert` binary — into one walkthrough that emits either an `sbatch` script or runs `bcl-convert` inline.

```
demux init <rundir>            # fresh demux: walk through prompts, emit sbatch + samplesheet
demux init <rundir> --run      # ...or run bcl-convert directly in the current session
demux run  <run-state-dir>     # run bcl-convert against an already-generated state dir
demux rescue <prev-state-dir>  # re-run after first demux, rescue from TopUnknownBarcodes.csv
demux status <state-dir>       # show decisions + artifact paths for a state dir
```

## Install (HPC)

### One-time Node + npm setup

On an interactive node:

```bash
# Node binary off Lustre (nodeenv was broken on at least one site)
curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o ~/node.tar.xz
mkdir -p /tmp/$USER && tar -xf ~/node.tar.xz -C /tmp/$USER
mv /tmp/$USER/node-v20.18.0-linux-x64 /tmp/$USER/demux-node
cp -r /tmp/$USER/demux-node ~/demux-node-stash    # persistent copy on home/Lustre

cat > ~/demux-activate <<'EOF'
LOCAL_NODE=/tmp/$USER/demux-node
if [ ! -x "$LOCAL_NODE/bin/node" ]; then
  mkdir -p "$(dirname "$LOCAL_NODE")"
  cp -r $HOME/demux-node-stash "$LOCAL_NODE"
fi
export NPM_CONFIG_CACHE=/tmp/$USER/npm-cache
export NPM_CONFIG_PREFIX=$HOME/demux-npm-prefix
export NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
mkdir -p "$NPM_CONFIG_CACHE" "$NPM_CONFIG_PREFIX"
export PATH="$LOCAL_NODE/bin:$NPM_CONFIG_PREFIX/bin:$PATH"
EOF
```

### Install demux

```bash
source ~/demux-activate

# install latest from GitHub main
npm install -g git+https://github.com/mikailbala/demux.git

# OR a specific tagged release
npm install -g git+https://github.com/mikailbala/demux.git#v0.2.0

# OR from a release tarball (no git on HPC required)
curl -fsSL https://github.com/mikailbala/demux/releases/latest/download/demux-0.2.0.tgz -o /tmp/demux.tgz
npm install -g /tmp/demux.tgz

demux --version
```

To update, re-run the same `npm install -g git+...` command — npm refetches and rebuilds.

Per new interactive session: `source ~/demux-activate`.

## Commands & options

### Global

```
demux --help
demux --version
```

### `demux init <rundir>`

Walks through 8 steps: parse → bcl-convert pick → sample filter → override cycles → reverse-complement → optional rescue → review → write.

| Flag | Description |
|---|---|
| `-s, --samplesheet <path>` | Override samplesheet path (defaults to `<rundir>/SampleSheet.csv`) |
| `-u, --top-unknown <path>` | Inline rescue against a `TopUnknownBarcodes.csv` from a prior demux |
| `-n, --match-len <n>` | Prefix-match length for rescue. Default `8` |
| `--bcl-convert <path>` | Skip the bcl-convert pick prompt; use this path |
| `--run` | After writing, run `bcl-convert` inline instead of emitting an sbatch script |
| `--threads <n>` | Thread count when `--run` is set. Default: `$SLURM_CPUS_PER_TASK` then `nproc-1` |
| `--force` | When `--run` is set, delete an existing `demux_out/` without prompting |
| `--drop-settings <list>` | Comma-separated BCLConvert_Settings keys to strip in addition to the built-in known-bad list |
| `--keep-all-settings` | Disable settings stripping entirely (you accept whatever bcl-convert says) |

### `demux rescue <prev-state-dir>`

Reads the previous run's `.demux/decisions.json` + its `Reports/TopUnknownBarcodes.csv`, prefix-matches against the existing samplesheet, lets you pick substitutions, and emits a sibling state dir `<prev>-rescue-N/`.

| Flag | Description |
|---|---|
| `-u, --top-unknown <path>` | Override the discovered TopUnknownBarcodes.csv path |
| `-n, --match-len <n>` | Prefix-match length. Default: same as the prev run |
| `--bcl-convert <path>` | Override which bcl-convert to use |
| `--run` | Run bcl-convert inline after writing the rescue state dir |
| `--threads <n>` | Thread count when `--run` is set |
| `--force` | When `--run` is set, delete an existing `demux_out/` without prompting |

### `demux run <run-state-dir>`

Runs bcl-convert in the foreground against an already-generated state dir. Tees stdout/stderr to console and to `.demux/bcl-convert.{stdout,stderr}.log`. Forwards Ctrl-C. Reports duration + exit code.

| Flag | Description |
|---|---|
| `--bcl-convert <path>` | Override which bcl-convert to use (else uses what `init` recorded) |
| `--threads <n>` | Thread count. Default: `$SLURM_CPUS_PER_TASK` then `nproc-1` |
| `--force` | Delete an existing `demux_out/` without prompting |

### `demux status <run-state-dir>`

Prints the decisions and artifact paths for a state dir. No flags.

## Environment variables

| Variable | Effect |
|---|---|
| `DEMUX_BCL_CONVERT` | Default bcl-convert path. Skips the discovery prompt. Override per-invocation with `--bcl-convert`. |
| `DEMUX_DEBUG=1` | Include stack traces in error output (default: hide them). |

## Behaviour you should know about

### Sample filtering

Three criteria: **lanes**, **Sample_ID/Sample_Name regex**, **explicit Sample_ID list**. AND across criteria types (each narrows the set), OR within one criterion. You can iterate until the matched count is what you expect.

### Reverse complement

Always per-index. Tool shows you the first 3 sample indices alongside their reverse-complements so you can sanity-check before answering Y/N for i7 and (if dual) i5.

### Index rescue

Prefix-match. For each sample, take the first N bases of i7 (and i5 if dual). Find unknown barcodes whose first N bases match. Rank by read count. You pick which substitutions to apply. The full unknown barcode replaces the original index in the samplesheet.

### Settings stripping (automatic)

`bcl-convert` rejects unrecognised settings, and rejects some settings under specific conditions. The tool strips:

- `AutoDetectDemuxMode`, `FastqcDownsampling` — always (BaseSpace-only keys)
- `TrimUMI`, `Read1UMILength`, `Read2UMILength` — when no `U<n>` segment is present in effective OverrideCycles
- `OverrideCycles` in `[BCLConvert_Settings]` — when per-row `OverrideCycles` is present in `[BCLConvert_Data]`

Disable with `--keep-all-settings`. Add more with `--drop-settings k1,k2`. The warning that prints during init shows you exactly what was removed and why.

### bcl-convert selection

`init` auto-discovers binaries from:

- `~/bin/bclConvert*/usr/bin/bcl-convert` (your site convention)
- `~/bin/bcl-convert`, `/opt/bcl-convert/bin/bcl-convert`, `/usr/local/bin/bcl-convert`, `/usr/bin/bcl-convert`
- whatever is on `PATH`

Each candidate is run with `--version` to extract the semver. You see the list with versions and pick. If your samplesheet declares a `SoftwareVersion` (in `[Header]` or `[BCLConvert_Settings]`), it's shown alongside; mismatches trigger a yellow warning but don't block.

Set `DEMUX_BCL_CONVERT=/path` or pass `--bcl-convert /path` to skip the prompt. The selected path + version is saved into `decisions.json` so `demux run` and `demux rescue` reuse it.

### Per-lane OverrideCycles

bcl-convert errors when `OverrideCycles` is set in both `[BCLConvert_Settings]` and `[BCLConvert_Data]`. The tool detects per-lane overrides in `[Data]`, shows you the unique variants + sample counts, skips the global override prompt, and strips `OverrideCycles` from `[Settings]` during write.

### Output directory

The tool does **not** pre-create `demux_out/` — bcl-convert refuses to run if it already exists.

- `demux run` checks for an existing `demux_out/` and prompts to delete it (`--force` skips the prompt).
- The generated `sbatch` script fails fast if `demux_out/` exists, with a one-line `rm -rf` suggestion in the error.

## State directory layout

Every invocation creates `./<run-id>/`:

```
./<run-id>/
  SampleSheet.csv          # final, generated
  demux.sbatch             # ready-to-submit (only when not --run)
  .demux/
    decisions.json         # everything you chose, plus timestamps + tool version
    samplesheet.original.csv
    samplesheet.filtered.csv
    samplesheet.final.csv
    runinfo.snapshot.json
    top-unknown.snapshot.csv         # only after rescue
    bcl-convert.stdout.log           # written by sbatch or `demux run`
    bcl-convert.stderr.log
```

Rescue creates `./<run-id>-rescue-N/` next to the source.

## Examples

```bash
# fully interactive — first time using the tool, walk through everything
demux init /lustre/illumina/20260507_LH00954_0008_A23K3HCLT3

# inline interactive run (skip the sbatch queue)
demux init /lustre/illumina/... --run

# you already know the binary, want to skip the prompt
DEMUX_BCL_CONVERT=~/bin/bclConvert4.5.4/usr/bin/bcl-convert \
  demux init /lustre/illumina/...

# inline rescue on first pass (you already have TopUnknownBarcodes.csv from a related run)
demux init /lustre/illumina/... --top-unknown ./previous-run/demux_out/Reports/TopUnknownBarcodes.csv

# review what `init` recorded
demux status ./20260507_LH00954_0008_A23K3HCLT3

# run bcl-convert against the state dir later (e.g. in a fresh interactive session)
source ~/demux-activate
demux run ./20260507_LH00954_0008_A23K3HCLT3

# rescue against this run's own TopUnknownBarcodes after bcl-convert finishes
demux rescue ./20260507_LH00954_0008_A23K3HCLT3 --run

# strip an extra setting bcl-convert complained about
demux init /lustre/illumina/... --drop-settings FastqCompressionFormat,Read1StartFromCycle

# don't strip any settings — you've checked them manually
demux init /lustre/illumina/... --keep-all-settings
```

## Troubleshooting

### `node -v` segfaults after install

`nodeenv` on certain Lustre filesystems corrupts the Node binary during extraction (CVE-2007-4559 tarfile mitigation in Python 3.9 silently drops content). Skip `nodeenv` entirely — see install section above for the manual tarball install.

### `npm` is slow / hangs

Lustre metadata is slow. Redirect npm cache off Lustre: `export NPM_CONFIG_CACHE=/tmp/$USER/npm-cache`. The `~/demux-activate` snippet above does this for you.

### bcl-convert reports "unrecognized setting X"

Add it to `--drop-settings X` for one-off use. If it shows up regularly across your samplesheets, open an issue (or add it to `KNOWN_UNSUPPORTED_BCL_SETTINGS` in `src/generators/samplesheet.js`).

### Wrong bcl-convert was picked

Pass `--bcl-convert /correct/path` or `export DEMUX_BCL_CONVERT=/correct/path`.

### "OverrideCycles in both [Settings] and [Data]" error

Should not occur — the tool auto-strips the global one. If it does, paste your samplesheet's structure (the section headers and the BCLConvert_Settings/Data layout) into an issue.

## Building from source

```bash
git clone <repo> && cd demux
npm install
npm test
npm run build      # → dist/demux.mjs (single ~1.2 MB bundle)
npm pack           # → demux-<version>.tgz
```

## Layout

- `src/parsers/` — RunInfo.xml, SampleSheet.csv (v1+v2), TopUnknownBarcodes.csv
- `src/core/` — filter, RC, cycles, rescue, bcl-convert discovery (pure functions)
- `src/generators/` — samplesheet + sbatch emitters
- `src/state/` — per-run state directory
- `src/ui/` — chalk/ora/inquirer-based TUI helpers
- `src/commands/` — orchestrators (`init`, `rescue`, `run`, `status`)
- `src/bin/demux.js` — CLI entry

## Out of scope

- Auto-detecting reverse-complement need from instrument/chemistry.
- Submitting `sbatch` jobs (you do that yourself).
- Post-demux QC / delivery automation.
