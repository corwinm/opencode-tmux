# opencode-tmux

CLI-first tooling for discovering `opencode` instances running in `tmux`.

This repo can also be installed as a TPM plugin.

## Current Status

The repository now has an initial Bun + TypeScript CLI scaffold and a working `list` command for discovering likely opencode panes.

The CLI now uses `commander` for command parsing so future subcommands can be added cleanly.

## Run

```bash
bun run src/cli.ts list
bun run src/cli.ts list --compact
bun run src/cli.ts popup
bun run src/cli.ts popup --busy
bun run src/cli.ts status
bun run src/cli.ts status --style tmux
bun run src/cli.ts status --summary
bun run src/cli.ts tmux-config
bun run src/cli.ts install-tmux
bun run src/cli.ts server-map-template
bun run src/cli.ts server-map-template --base-port 4096
bun run src/cli.ts list --provider sqlite
bun run src/cli.ts list --provider plugin
bun run src/cli.ts list --provider server --server-map '{"opencode-tmux:1.2":"http://127.0.0.1:4096"}'
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
- `popup` to open a tmux-native chooser backed by the CLI switch command
- `status` for tmux status-line text showing the current pane plus a background summary
- `tmux-config` to generate a ready-to-paste tmux integration snippet
- `install-tmux` to update `.tmux.conf` with a managed opencode-tmux block
- optional tmux-colored status output with `status --style tmux`
- `--active`, `--busy`, `--waiting`, and `--running` filters for `list` and `switch`
- `list --compact` for tmux-friendly tab-separated output
- runtime provider selection: `auto`, `sqlite`, or explicit `server` endpoints via `--server-map`
- file-based opencode plugin provider for event-driven state publication
- `server-map-template` to generate explicit pane-to-endpoint mappings
- `server-map-template --base-port 4096` to prefill sequential local ports
- validated current behavior: headless `opencode serve` may return empty `{}` from `/session/status` until a session is actively attached, so `auto` falls back to sqlite
- `list --watch` with configurable refresh interval
- higher-level runtime activity labels (`busy`, `idle`, `unknown`) alongside detailed statuses
- matched session title shown in list output
- structured runtime match metadata in JSON output for future tmux-native consumers
- human-readable and JSON output

## Next Up

- better pane-to-session mapping when cwd is not an exact match

## Tmux Popup

Inside tmux:

```bash
bun run src/cli.ts popup
bun run src/cli.ts popup --busy
```

## TPM

Add the plugin to `.tmux.conf`:

```tmux
set -g @plugin 'corwinm/opencode-tmux'
```

Optional TPM settings:

```tmux
set -g @opencode-tmux-key 'O'
set -g @opencode-tmux-waiting-key 'W'
set -g @opencode-tmux-launcher 'menu'
set -g @opencode-tmux-install-opencode-plugin 'on'
set -g @opencode-tmux-provider 'plugin'
set -g @opencode-tmux-popup-filter 'all'
set -g @opencode-tmux-status 'on'
set -g @opencode-tmux-status-style 'tmux'
set -g @opencode-tmux-status-position 'right'
set -g @opencode-tmux-status-interval '1'
```

Available TPM options:

- `@opencode-tmux-key`
- `@opencode-tmux-waiting-key`
- `@opencode-tmux-launcher` (`menu` or `popup`)
- `@opencode-tmux-install-opencode-plugin` (`on` or `off`)
- `@opencode-tmux-provider`
- `@opencode-tmux-server-map`
- `@opencode-tmux-popup-filter` (`all`, `busy`, `waiting`, `running`, `active`)
- `@opencode-tmux-popup-width`
- `@opencode-tmux-popup-height`
- `@opencode-tmux-popup-title`
- `@opencode-tmux-status` (`on` or `off`)
- `@opencode-tmux-status-style` (`plain` or `tmux`)
- `@opencode-tmux-status-position` (`right` or `left`)
- `@opencode-tmux-status-interval` (tmux `status-interval`, default `1`)

After installing with TPM, press prefix + `I` and reload tmux if needed. TPM users also need `bun` installed because the plugin runs the local CLI.

By default, the TPM plugin also installs the bundled opencode plugin by creating a symlink at:

```text
~/.config/opencode/plugins/opencode-tmux.ts
```

You can disable that behavior with:

```tmux
set -g @opencode-tmux-install-opencode-plugin 'off'
```

The default TPM launcher is `menu` because it is more reliable than a popup-based interactive shell on some systems. By default it shows all discovered opencode sessions with their statuses. You can opt into the popup launcher with:

```tmux
set -g @opencode-tmux-launcher 'popup'
```

To enable the status line when using TPM, add:

```tmux
set -g @opencode-tmux-status 'on'
set -g @opencode-tmux-status-style 'tmux'
set -g @opencode-tmux-status-position 'right'
set -g @opencode-tmux-status-interval '1'
```

Then install or reload TPM:

```tmux
prefix + I
```

If you are not using TPM, generate a ready-to-paste snippet instead:

```bash
bun run src/cli.ts tmux-config
```

## Opencode Plugin

This repo now includes an opencode plugin in `plugin/opencode-tmux.ts`.

The plugin writes normalized session state files to:

```text
~/.local/state/opencode-tmux/plugin-state
```

The CLI can read those files with:

```bash
bun run src/cli.ts list --provider plugin
```

If you install with TPM, the bundled opencode plugin is symlinked automatically by default.

That creates:

```text
~/.config/opencode/plugins/opencode-tmux.ts
```

If you are wiring it up manually without TPM, create the symlink yourself:

```bash
ln -sfn /path/to/opencode-tmux/plugin/opencode-tmux.ts ~/.config/opencode/plugins/opencode-tmux.ts
```

Once installed, restart opencode sessions so the plugin is loaded.

Recommended tmux TPM settings when using the plugin backend:

```tmux
set -g @opencode-tmux-provider 'plugin'
set -g @opencode-tmux-status 'on'
set -g @opencode-tmux-status-interval '1'
```

## Tmux Status Line

If you are not using TPM, example tmux `status-right` usage:

```tmux
set -g status-right '#(cd /path/to/opencode-tmux && bun run src/cli.ts status)'
```

For tmux color formatting:

```tmux
set -g status-right '#(cd /path/to/opencode-tmux && bun run src/cli.ts status --style tmux)'
```

Current status output also includes simple symbols:

- `!` waiting for user response
- `*` busy/running
- `-` idle/none
- `~` unknown

Inside tmux, the default status output shows both `cur` and `bg` segments so you can see the focused pane state alongside background opencode activity.

To always show a global summary instead of the current pane context:

```tmux
set -g status-right '#(cd /path/to/opencode-tmux && bun run src/cli.ts status --summary)'
```

## Tmux Config Generator

Generate a snippet with a popup binding and status line:

```bash
bun run src/cli.ts tmux-config
```

Customize the popup filter or key binding:

```bash
bun run src/cli.ts tmux-config --popup-filter waiting --key W
```

## Tmux Installer

Write or update a managed `opencode-tmux` block in `~/.tmux.conf`:

```bash
bun run src/cli.ts install-tmux
tmux source-file ~/.tmux.conf
```

Target a different tmux config file if needed:

```bash
bun run src/cli.ts install-tmux --file ~/.config/tmux/tmux.conf
```
