#!/usr/bin/env bash
set -uo pipefail

main() {
  agent-ship --version >/dev/null 2>&1 || return 0
  printf '%s\n' "$(<"${BASH_SOURCE[0]%/*}/note.md")"
  return 0
}

main
