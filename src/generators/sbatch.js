const TEMPLATE = `#!/bin/bash
#SBATCH --job-name=demux-\${JOB_TAG}
#SBATCH --cpus-per-task=\${CPUS}
#SBATCH --mem=\${MEM}
#SBATCH --time=\${WALLTIME}
#SBATCH --ntasks=1
#SBATCH --output=\${STATE_DIR}/bcl-convert.stdout.log
#SBATCH --error=\${STATE_DIR}/bcl-convert.stderr.log
\${PARTITION_LINE}\${ACCOUNT_LINE}
set -euo pipefail

echo "[demux] $(date -Is) starting bcl-convert"
echo "[demux] run dir:      \${RUNDIR}"
echo "[demux] output dir:   \${OUTPUT_DIR}"
echo "[demux] samplesheet:  \${SAMPLESHEET}"
echo "[demux] cpus:         $\${SLURM_CPUS_PER_TASK:-unknown}"

# bcl-convert refuses to overwrite an existing output directory.
# If a previous attempt left one behind, remove it before re-submitting
# (or edit this block to abort instead).
if [ -e "\${OUTPUT_DIR}" ]; then
  echo "[demux] ERROR: \${OUTPUT_DIR} already exists from a previous run"
  echo "[demux]        delete it manually and re-submit:  rm -rf \${OUTPUT_DIR}"
  exit 1
fi

\${BCL_CONVERT_PATH} \\
  --bcl-input-directory \${RUNDIR} \\
  --output-directory \${OUTPUT_DIR} \\
  --sample-sheet \${SAMPLESHEET} \\
  --bcl-num-conversion-threads $\${SLURM_CPUS_PER_TASK:-8} \\
  --bcl-num-compression-threads $\${SLURM_CPUS_PER_TASK:-8}

echo "[demux] $(date -Is) bcl-convert finished"
`;

const DEFAULTS = {
  CPUS: '32',
  MEM: '240G',
  WALLTIME: '12:00:00',
  BCL_CONVERT_PATH: '~/bin/bclConvert/usr/bin/bcl-convert',
};

export function renderSbatch(vars) {
  const merged = { ...DEFAULTS, ...vars };
  merged.PARTITION_LINE = merged.PARTITION
    ? `#SBATCH --partition=${merged.PARTITION}\n`
    : '';
  merged.ACCOUNT_LINE = merged.ACCOUNT
    ? `#SBATCH --account=${merged.ACCOUNT}\n`
    : '';

  return TEMPLATE
    .replace(/\$\{(\w+)\}/g, (m, key) => (key in merged ? String(merged[key] ?? '') : m))
    .replace(/\$\$/g, '$');
}
