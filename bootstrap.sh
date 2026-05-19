#!/usr/bin/env bash
# demux bootstrap — provisions Node via nodeenv on an HPC interactive node,
# then installs the demux CLI globally inside that env.
#
# Usage:
#   bash bootstrap.sh                  # default install at ~/demux/.nodeenv
#   DEMUX_PREFIX=/path/to/dir bash bootstrap.sh
#
# Idempotent: detects an existing env and offers reuse.

set -euo pipefail

PREFIX="${DEMUX_PREFIX:-$HOME/demux}"
ENV_DIR="$PREFIX/.nodeenv"
NODE_VERSION="${DEMUX_NODE_VERSION:-20.18.0}"
TARBALL="${DEMUX_TARBALL:-}"

# ANSI helpers ---------------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_WARN=$'\033[33m'
  C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_BRAND=$'\033[35m'; C_RESET=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_WARN=""; C_DIM=""; C_BOLD=""; C_BRAND=""; C_RESET=""
fi
say()  { printf "%s%s%s\n" "${C_BRAND}" "› $*" "${C_RESET}"; }
ok()   { printf "%s%s%s\n" "${C_OK}"   "✔ $*" "${C_RESET}"; }
warn() { printf "%s%s%s\n" "${C_WARN}" "⚠ $*" "${C_RESET}"; }
die()  { printf "%s%s%s\n" "${C_ERR}"  "✖ $*" "${C_RESET}" >&2; exit 1; }
dim()  { printf "%s%s%s\n" "${C_DIM}"  "  $*" "${C_RESET}"; }

# Preflight ------------------------------------------------------------------
say "demux bootstrap"
echo

if ! command -v nodeenv >/dev/null 2>&1; then
  die "nodeenv not found on PATH. On an interactive node, try: \`module load nodeenv\` or check with the HPC docs."
fi
ok "nodeenv detected ($(nodeenv --version 2>/dev/null || echo unknown))"

# Resolve tarball location
if [ -z "$TARBALL" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if ls "$HERE"/demux-*.tgz >/dev/null 2>&1; then
    TARBALL="$(ls -1t "$HERE"/demux-*.tgz | head -n1)"
  elif [ -d "$HERE/dist" ] && [ -f "$HERE/package.json" ]; then
    TARBALL="$HERE"  # install from local directory
  fi
fi
if [ -z "$TARBALL" ]; then
  die "no demux tarball or local install found. Set DEMUX_TARBALL=/path/to/demux-x.y.z.tgz."
fi
ok "install source: $TARBALL"

# Env management -------------------------------------------------------------
mkdir -p "$PREFIX"
if [ -d "$ENV_DIR" ] && [ -x "$ENV_DIR/bin/node" ]; then
  warn "existing nodeenv at $ENV_DIR"
  printf "%s" "${C_BOLD}recreate it? [y/N] ${C_RESET}"
  read -r ans
  if [[ "$ans" =~ ^[Yy] ]]; then
    rm -rf "$ENV_DIR"
  else
    ok "reusing existing env"
  fi
fi

if [ ! -d "$ENV_DIR" ]; then
  say "provisioning Node $NODE_VERSION into $ENV_DIR"
  nodeenv --node="$NODE_VERSION" --prebuilt "$ENV_DIR" \
    || die "nodeenv provisioning failed"
  ok "Node ready"
fi

# Activate and install -------------------------------------------------------
# shellcheck disable=SC1091
source "$ENV_DIR/bin/activate"
ok "activated $ENV_DIR ($(node -v))"

say "installing demux"
npm install -g --no-audit --no-fund "$TARBALL" \
  || die "npm install failed"
ok "demux installed: $(which demux)"

# Helper -------------------------------------------------------------------
HELPER="$PREFIX/activate"
cat > "$HELPER" <<EOF
# source this to activate the demux env
source "$ENV_DIR/bin/activate"
EOF
ok "wrote activate helper → $HELPER"

# Done -----------------------------------------------------------------------
echo
say "next steps"
dim "in any new interactive session, activate with:"
echo "    ${C_BOLD}source $HELPER${C_RESET}"
dim "then run:"
echo "    ${C_BOLD}demux init /path/to/rundir${C_RESET}"
echo
