#!/usr/bin/env bash
# Fail when tracked files look like runtime data or contain common secret formats.
# Only file names are reported; matching values are never printed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

declare -A REPORTED=()
failed=0

report() {
  local file="$1" reason="$2"
  local key="${file}:${reason}"
  [[ -n "${REPORTED[$key]:-}" ]] && return
  REPORTED[$key]=1
  printf 'ERROR: tracked %s: %s\n' "$file" "$reason" >&2
  failed=1
}

# Block runtime artifacts even when an ignore rule is accidentally removed.
while IFS= read -r -d '' file; do
  base="${file##*/}"

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
done < <(git ls-files -z)

# Search common credential formats. Exclude this file because it contains the
# detection expressions themselves. git-grep only reads tracked files.
matches="$(mktemp -t manifold-secret-scan-XXXXXX)"
trap 'rm -f "$matches"' EXIT

if git grep -I -l -z -E \
  -e '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----' \
  -e 'sk-(proj-|svcacct-)[A-Za-z0-9_-]{20,}' \
  -e 'sk-[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{16,}' \
  -e 'sk_live_[A-Za-z0-9]{16,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e 'AIza[0-9A-Za-z_-]{30,}' \
  -e 'gh[pousr]_[A-Za-z0-9]{20,}' \
  -e 'xox[baprs]-[A-Za-z0-9-]{20,}' \
  -e 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' \
  -- . ':(exclude)scripts/check-secrets.sh' >"$matches"; then
  while IFS= read -r -d '' file; do
    report "$file" "content matches a common credential format"
  done <"$matches"
fi

if [[ "$failed" -ne 0 ]]; then
  printf 'Secret hygiene check failed. Remove the tracked artifact and rotate exposed credentials.\n' >&2
  exit 1
fi

printf 'Secret hygiene check passed (tracked files only).\n'
