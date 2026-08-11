#!/usr/bin/env bash
# Fail when tracked files or reachable history contain common secret formats.
# Only file names and abbreviated commit IDs are reported; values are never printed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

SCAN_HISTORY=0
case "${1:-}" in
  "") ;;
  --history) SCAN_HISTORY=1 ;;
  -h|--help)
    printf 'Usage: %s [--history]\n' "$0"
    exit 0
    ;;
  *)
    printf 'Unknown argument: %s\n' "$1" >&2
    exit 2
    ;;
esac

declare -A REPORTED=()
failed=0

report() {
  local item="$1" reason="$2"
  local key="current:${item}:${reason}"
  [[ -n "${REPORTED[$key]:-}" ]] && return
  REPORTED[$key]=1
  printf 'ERROR: tracked %s: %s\n' "$item" "$reason" >&2
  failed=1
}

report_history() {
  local commit="$1" file="$2" reason="$3"
  local key="history:${file}:${reason}"
  [[ -n "${REPORTED[$key]:-}" ]] && return
  REPORTED[$key]=1
  printf 'ERROR: reachable history %s at %.12s: %s\n' "$file" "$commit" "$reason" >&2
  failed=1
}

check_current_path() {
  local file="$1" base="${1##*/}"

  case "$base" in
    .env.example|.env.*.example) ;;
    .env|.env.*) report "$file" "environment file may contain secrets" ;;
  esac

  case "/$file/" in
    */deploy/data/*|*/deploy/data-staging/*|*/blobs/*|*/_blobs/*)
      report "$file" "runtime data must stay outside Git"
      ;;
  esac

  case "$base" in
    *.db|*.db-wal|*.db-shm|*.sqlite|*.sqlite-wal|*.sqlite-shm)
      report "$file" "database state must stay outside Git"
      ;;
    *.key|*.p12|*.pfx|*.token)
      report "$file" "private key or token file must stay outside Git"
      ;;
  esac
}

check_history_path() {
  local commit="$1" file="$2" base="${2##*/}"

  case "$base" in
    .env.example|.env.*.example) ;;
    .env|.env.*)
      report_history "$commit" "$file" "environment file may contain secrets"
      ;;
  esac

  case "/$file/" in
    */deploy/data/*|*/deploy/data-staging/*|*/blobs/*|*/_blobs/*)
      report_history "$commit" "$file" "runtime data must stay outside Git"
      ;;
  esac

  case "$base" in
    *.db|*.db-wal|*.db-shm|*.sqlite|*.sqlite-wal|*.sqlite-shm)
      report_history "$commit" "$file" "database state must stay outside Git"
      ;;
    *.key|*.p12|*.pfx|*.token)
      report_history "$commit" "$file" "private key or token file must stay outside Git"
      ;;
  esac
}

readonly -a SECRET_PATTERNS=(
  '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----'
  'sk-(proj-|svcacct-)[A-Za-z0-9_-]{20,}'
  'sk-[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{16,}'
  'sk_live_[A-Za-z0-9]{16,}'
  'AKIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z_-]{30,}'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{20,}'
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
)

grep_secrets() {
  local ref="${1:-}" pattern
  local -a command=(git grep -I -l -z -E)

  for pattern in "${SECRET_PATTERNS[@]}"; do
    command+=(-e "$pattern")
  done
  if [[ -n "$ref" ]]; then
    command+=("$ref")
  fi
  command+=(-- . ':(exclude)scripts/check-secrets.sh')
  "${command[@]}"
}

matches="$(mktemp -t manifold-secret-scan-XXXXXX)"
paths="$(mktemp -t manifold-secret-paths-XXXXXX)"
commits="$(mktemp -t manifold-secret-commits-XXXXXX)"
trap 'rm -f "$matches" "$paths" "$commits"' EXIT

# Use regular temporary-file commands instead of process substitutions so a Git
# read failure cannot be mistaken for an empty, successful scan.
git ls-files -z >"$paths"
while IFS= read -r -d '' file; do
  check_current_path "$file"
done <"$paths"

if grep_secrets >"$matches"; then
  while IFS= read -r -d '' file; do
    report "$file" "content matches a common credential format"
  done <"$matches"
else
  grep_status=$?
  [[ "$grep_status" -eq 1 ]] || {
    printf 'ERROR: Git failed while scanning tracked content.\n' >&2
    exit "$grep_status"
  }
fi

if [[ "$SCAN_HISTORY" -eq 1 ]]; then
  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    printf 'ERROR: --history requires a full clone; fetch with depth 0 first.\n' >&2
    exit 1
  fi

  git rev-list --all >"$commits"
  while IFS= read -r commit; do
    git ls-tree -r --name-only -z "$commit" >"$paths"
    while IFS= read -r -d '' file; do
      check_history_path "$commit" "$file"
    done <"$paths"

    : >"$matches"
    if grep_secrets "$commit" >"$matches"; then
      while IFS= read -r -d '' match; do
        file="${match#*:}"
        report_history "$commit" "$file" "content matches a common credential format"
      done <"$matches"
    else
      grep_status=$?
      [[ "$grep_status" -eq 1 ]] || {
        printf 'ERROR: Git failed while scanning reachable commit %.12s.\n' "$commit" >&2
        exit "$grep_status"
      }
    fi
  done <"$commits"
fi

if [[ "$failed" -ne 0 ]]; then
  printf 'Secret hygiene check failed. Remove the artifact and rotate exposed credentials.\n' >&2
  exit 1
fi

if [[ "$SCAN_HISTORY" -eq 1 ]]; then
  printf 'Secret hygiene check passed (tracked files and reachable history).\n'
else
  printf 'Secret hygiene check passed (tracked files).\n'
fi
