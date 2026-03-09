#!/usr/bin/env bash

set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$CURRENT_DIR/src/cli.ts"

if [ ! -f "$CLI" ]; then
  tmux display-message "opencode-tmux: missing CLI at $CLI"
  exit 0
fi

shell_escape() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

ARGS=("$@")
LIST_ARGS=(list --compact)
SWITCH_ARGS=(switch)

for arg in "${ARGS[@]}"; do
  LIST_ARGS+=("$arg")
  SWITCH_ARGS+=("$arg")
done

LINES=()
while IFS= read -r line; do
  LINES+=("$line")
done < <(cd "$CURRENT_DIR" && bun run "$CLI" "${LIST_ARGS[@]}")

if [ "${#LINES[@]}" -eq 0 ] || [ -z "${LINES[0]}" ]; then
  tmux display-message "opencode-tmux: no matching panes"
  exit 0
fi

MENU_CMD=(tmux display-menu -T "OpenCode Sessions" -x C -y C)

INDEX=1
for line in "${LINES[@]}"; do
  IFS=$'\t' read -r target activity status source active session_title pane_title current_path <<<"$line"
  label="$INDEX. $target $activity/$status $session_title"
  key=""
  if [ "$INDEX" -le 9 ]; then
    key="$INDEX"
  fi

  switch_command="cd $(shell_escape "$CURRENT_DIR") && bun run $(shell_escape "$CLI") switch"
  for arg in "${ARGS[@]}"; do
    switch_command="$switch_command $(shell_escape "$arg")"
  done
  switch_command="$switch_command $(shell_escape "$target")"

  MENU_CMD+=("$label" "$key" "run-shell \"$switch_command\"")
  INDEX=$((INDEX + 1))
done

MENU_CMD+=("Cancel" "q" "display-message \"opencode-tmux: cancelled\"")

"${MENU_CMD[@]}"
