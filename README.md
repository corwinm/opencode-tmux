# opencode-tmux

CLI-first tooling for discovering `opencode` instances running in `tmux`.

## Current Status

The repository now has an initial Bun + TypeScript CLI scaffold and a working `list` command for discovering likely opencode panes.

The CLI now uses `commander` for command parsing so future subcommands can be added cleanly.

## Run

```bash
bun run src/cli.ts list
bun run src/cli.ts list --watch
bun run src/cli.ts list --watch --interval 1
bun run src/cli.ts list --busy
bun run src/cli.ts list --waiting
bun run src/cli.ts list --running
bun run src/cli.ts list --active
bun run src/cli.ts list --json
bun run src/cli.ts inspect opencode-tmux:1.2
bun run src/cli.ts switch
bun run src/cli.ts switch --busy
bun run src/cli.ts switch --waiting
bun run src/cli.ts switch --running
bun run src/cli.ts switch opencode-tmux:1.2
```

## Scope So Far

- Bun + TypeScript project scaffold
- tmux pane discovery
- heuristic detection of likely opencode panes
- SQLite-backed runtime status detection for matched sessions
- conservative descendant-session heuristics when cwd is broader than the actual project
- `inspect <target>` for debugging pane and session mapping
- interactive `switch` chooser when no target is provided
- `switch <target>` for direct tmux navigation
- `--active`, `--busy`, `--waiting`, and `--running` filters for `list` and `switch`
- `list --watch` with configurable refresh interval
- higher-level runtime activity labels (`busy`, `idle`, `unknown`) alongside detailed statuses
- matched session title shown in list output
- structured runtime match metadata in JSON output for future tmux-native consumers
- human-readable and JSON output

## Next Up

- better pane-to-session mapping when cwd is not an exact match
