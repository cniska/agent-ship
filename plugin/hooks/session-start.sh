#!/usr/bin/env bash
set -uo pipefail

main() {
  agent-ship --version >/dev/null 2>&1 || return 0
  printf '%s\n' "$(<"${BASH_SOURCE[0]%/*}/note.md")"
  local notice
  notice="$(agent-ship notice agent-ship cniska/agent-ship 2>/dev/null)" || return 0
  [ -z "$notice" ] || printf '\n%s\n' "$notice"
  return 0
}

main
