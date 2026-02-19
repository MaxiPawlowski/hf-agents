#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

if [ "$#" -lt 1 ]; then
  printf 'usage: %s <script-name> [args...]\n' "$0" >&2
  exit 2
fi

SCRIPT_NAME="$1"
shift

TARGET="${SCRIPT_DIR}/${SCRIPT_NAME}"
if [ ! -f "$TARGET" ]; then
  printf 'hook script not found: %s\n' "$TARGET" >&2
  exit 2
fi

"$TARGET" "$@"
