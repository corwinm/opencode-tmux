# Claude Code support: research and implementation plan

> Linked issue: [#1 — Add support for Claude Code?](https://github.com/corwinm/coding-agents-tmux/issues/1)

## Goal

Add support for **Claude Code** sessions in `coding-agents-tmux` for:

- pane discovery
- switching and popup navigation
- status line summaries
- higher-fidelity runtime state than simple `pane_current_command === claude`

The main research question for this doc was:

- can Claude Code support the same general pattern we already use elsewhere here, where a local integration publishes normalized runtime state by hooking into lifecycle events?

## Short answer

**Yes.** Claude Code has a strong hook system and a plugin system that can ship those hooks.

The cleanest v1 path looks very similar to the existing Codex integration:

- detect Claude Code panes in tmux
- install or generate Claude Code hook configuration
- have hook events call back into `coding-agents-tmux`
- write normalized state files under this repo's own state directory
- read those state files when rendering tmux UI

The main difference from Pi is:

- Pi has a native extension API with JS lifecycle listeners
- Claude Code primarily exposes **hook events** and **plugins that bundle hook definitions**

So the Claude Code equivalent of a Pi extension is not a TypeScript extension module first; it is a **hook-backed integration**, optionally packaged as a Claude Code plugin later.

## Research summary

### 1. Claude Code exposes lifecycle hooks directly

Claude Code docs include a full hooks reference and hook guide.

Relevant supported events include:

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PermissionDenied`
- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `Notification`
- `SubagentStart`
- `SubagentStop`
- `Stop`
- `StopFailure`
- `Elicitation`
- `ElicitationResult`
- `CwdChanged`
- `ConfigChange`
- others not immediately relevant to tmux state

Those hooks receive JSON on stdin for command hooks and can run shell commands, HTTP handlers, MCP tools, prompt hooks, or agent hooks.

For this repo, **command hooks** are the most natural fit.

### 2. Claude Code can package hooks inside a plugin

Claude Code plugins can include:

- skills
- agents
- hooks
- MCP servers
- LSP servers
- monitors

Plugin hooks live in:

- `hooks/hooks.json`

and support the same lifecycle events as standalone hooks.

So, from a capability perspective, **yes, Claude Code can support an “extension-like” packaged integration**.

### 3. Standalone hooks are probably the best first install surface

Claude Code supports hooks in:

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- plugin `hooks/hooks.json`

That means we have two viable integration shapes:

#### A. Standalone hook config

Pros:

- simple
- close to the existing Codex install model
- can be installed or merged by our CLI
- works without needing a plugin marketplace workflow

Cons:

- less “packaged” than a Claude plugin
- modifies Claude settings JSON directly

#### B. Claude Code plugin with bundled hooks

Pros:

- cleaner long-term packaging story
- naturally shareable
- closest conceptual match to “extension support”

Cons:

- docs are more plugin/marketplace-oriented for installation
- likely more moving parts for users than a simple hook install
- not clearly the fastest path to working tmux support

### 4. Claude Code hook events are rich enough for waiting/running/idle detection

This was the key feasibility question.

The answer is also **yes**.

The hooks surface gives enough signal to derive the statuses this repo already uses:

- `new`
- `running`
- `waiting-question`
- `waiting-input`
- `idle`
- `unknown`

Important events for that mapping:

- `SessionStart` → session initialized
- `UserPromptSubmit` → user has started a new turn, Claude is running
- `PreToolUse` / `PostToolUse` / `PostToolBatch` → Claude is still actively working
- `PermissionRequest` → Claude is blocked on permission UI
- `Elicitation` → Claude is blocked on user input requested by an MCP server
- `Stop` → Claude has finished a turn; can classify idle vs waiting from message text
- `SessionEnd` → cleanup state file

### 5. Claude Code specifically exposes question-like tools/events

Two especially useful pieces of hook data:

#### `AskUserQuestion` tool

`PreToolUse` supports matching on tool name, and Claude Code documents an `AskUserQuestion` tool.

That means we can explicitly detect when Claude itself is prompting the user.

This is better than relying only on text heuristics.

#### `PermissionRequest` and `Elicitation`

Claude Code has first-class events for:

- permission dialogs
- MCP elicitation dialogs / responses

Those are exactly the kinds of states that a tmux integration wants to surface as “waiting on the user”.

## Recommendation

## Recommended v1 architecture

Implement Claude Code support as a **hook-backed runtime provider**, not a plugin-first provider.

That means:

1. add Claude Code pane detection
2. add a Claude-specific runtime reader/writer path
3. generate/install Claude hook config that invokes a `coding-agents-tmux` CLI ingest command
4. persist normalized Claude state files under the same state root pattern used for Codex and Pi
5. keep plugin packaging as a later optional layer

This is the lowest-risk path and fits the current repo architecture best.

## Why this is the right first step

### It matches the repo’s existing support patterns

Current models:

- OpenCode: bundled plugin writes state
- Codex: hooks write state
- Pi: bundled extension writes state

Claude Code most naturally matches **Codex-style hook ingestion**.

### It avoids blocking on plugin packaging details

Claude Code absolutely can package hooks inside a plugin, but that does not mean plugin packaging needs to be the first implementation milestone.

We can get working support by using the core lifecycle hook system first.

### It keeps a single authoritative state format

Like the other providers, Claude Code should publish normalized state into:

- `~/.local/state/coding-agents-tmux/claude-state`

Then tmux rendering stays agent-neutral.

## Proposed architecture

### New runtime path

Add a Claude-specific runtime module, likely:

- `src/core/claude.ts`

Responsibilities:

- read Claude state files
- match them to tmux panes by target / pane id / safe cwd fallback
- classify runtime info into the shared `RuntimeInfo` model
- optionally expose install/template helpers for Claude hook config

### New state directory

Use a dedicated state directory:

- preferred: `~/.local/state/coding-agents-tmux/claude-state`
- legacy alias only if needed later: `~/.local/state/opencode-tmux/claude-state`

Recommended env overrides:

- `CODING_AGENTS_TMUX_CLAUDE_STATE_DIR`
- optional legacy alias if we decide rename compatibility matters here too

### New CLI ingestion command

Add a command such as:

- `coding-agents-tmux claude-hook-state`

Behavior:

- read one Claude Code hook payload from stdin
- inspect `hook_event_name`
- classify runtime state
- resolve `TMUX_PANE` to tmux target when possible
- write a normalized state file
- refresh tmux clients if needed

This should be the Claude analogue of:

- `coding-agents-tmux codex-hook-state`

### New install/template commands

Likely commands:

- `coding-agents-tmux claude-hooks-template`
- `coding-agents-tmux install-claude`

Suggested behavior:

#### `claude-hooks-template`

Print a hook config snippet or settings JSON fragment users can merge into:

- `.claude/settings.json`
- or `~/.claude/settings.json`

#### `install-claude`

Merge managed hooks into:

- `~/.claude/settings.json`

This should be conservative and idempotent, similar in spirit to `install-codex`.

## Event mapping proposal

Below is a practical first-pass mapping from Claude hook events to this repo’s normalized statuses.

### `SessionStart`

Set:

- `status: "new"`
- `activity: "idle"`
- `detail: "Claude Code session started"`

### `UserPromptSubmit`

Set:

- `status: "running"`
- `activity: "busy"`
- `detail: "Claude Code is processing a user prompt"`

### `PreToolUse`

Default for most tools:

- `status: "running"`
- `activity: "busy"`

Special cases:

#### `tool_name === "AskUserQuestion"`

Classify as waiting instead of running.

If the payload clearly has option-based questions:

- `status: "waiting-question"`

If it is freeform / no options:

- `status: "waiting-input"`

This is likely the highest-value explicit waiting signal.

### `PermissionRequest`

Set:

- `status: "waiting-question"`
- `activity: "busy"`
- `detail: "Claude Code is waiting for permission approval"`

Rationale:

- it is a structured approval prompt
- from the user’s point of view it behaves like a question/decision state

### `Elicitation`

Set:

- default `status: "waiting-question"`
- `activity: "busy"`

Potential refinement later:

- map some elicitation modes to `waiting-input` if the payload clearly describes freeform text entry

### `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `SubagentStart`, `SubagentStop`

In general, set or preserve:

- `status: "running"`
- `activity: "busy"`

These are mostly “Claude is still in the middle of work” signals.

### `PermissionDenied`

Likely keep as:

- `status: "running"`
- `activity: "busy"`

unless we discover a better user-facing interpretation during implementation.

### `Stop`

This is the primary end-of-turn classifier.

Use `last_assistant_message` to distinguish:

- `idle`
- `waiting-input`
- `waiting-question`

Initial heuristic:

- explicit multiple-choice / select-like language → `waiting-question`
- question / confirmation text → `waiting-input`
- otherwise → `idle`

This is similar to the current Codex and Pi best-effort stop-time classification, but should be stronger because Claude also gives us earlier explicit waiting events.

### `Notification`

Optional in v1.

Possible uses:

- `permission_prompt` → waiting-question
- `idle_prompt` → waiting-input or generic waiting
- `elicitation_dialog` → waiting-question
- `elicitation_complete` / `elicitation_response` → clear back to running

This may be useful as an additional signal layer, but it is not required for the first version.

### `SessionEnd`

Remove the state file for the session/pane.

## Proposed normalized Claude state file

Suggested shape:

```ts
interface ClaudeStateFile {
  activity?: "busy" | "idle" | "unknown";
  detail?: string;
  directory?: string;
  paneId?: string | null;
  sessionId?: string;
  sourceEventType?: string;
  status?: "running" | "waiting-question" | "waiting-input" | "idle" | "new" | "unknown";
  target?: string | null;
  title?: string;
  transcriptPath?: string | null;
  updatedAt?: number;
  version?: number;
}
```

This matches the shape already used for Codex/Pi closely enough to keep implementation straightforward.

## Hook configuration strategy

### Recommended managed hook set for v1

We do not need every Claude Code event.

A focused initial set is probably enough:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `Elicitation`
- `ElicitationResult`
- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `Stop`
- `SessionEnd`

All of them can call the same ingest command:

```json
{
  "type": "command",
  "command": "/path/to/coding-agents-tmux claude-hook-state",
  "statusMessage": "Updating Claude Code tmux state"
}
```

Then the ingest command decides what to do based on the incoming `hook_event_name` and payload.

### Config location recommendation

For the first implementation, support two paths:

#### Global install

Update:

- `~/.claude/settings.json`

This mirrors the current Codex install approach and gives users one command to enable Claude Code support.

#### Repo-local template

Print a template users can redirect into:

- `.claude/settings.json`

This is useful for experimentation and for teams that want repo-scoped Claude Code support.

## Should we also ship a Claude Code plugin?

## Recommendation: not required for v1, but worth planning

A Claude Code plugin is absolutely viable later.

Possible future directory:

- `plugin/claude-code/`

Potential contents:

- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- maybe scripts if we want a fully self-contained package

That plugin could call back into:

- the installed `coding-agents-tmux` CLI
- or scripts bundled in the plugin package

### Why not make plugin packaging the first milestone?

Because the real value for tmux support is the **hook event stream**, not the plugin container.

Plugin packaging is mostly a distribution and install story.

So the order should be:

1. make hook-backed support work
2. optionally wrap it in a Claude plugin later

## Pane detection proposal

Add Claude Code pane detection in:

- `src/core/tmux.ts`

Likely signals:

- `pane_current_command === claude`
- title hints like `Claude` or `Claude Code`, if they prove stable enough

Recommendation:

- start with command-based detection first
- add title hints only if needed after testing

## Runtime model changes

### Agent naming

Use `"claude"` as the agent kind.

That should be the name used for:

- internal type values
- CLI filters like `--agent claude`
- pane detection and runtime routing code

In prose and user-facing documentation we can still refer to the product as **Claude Code** where that is clearer.

Reason:

- the executable is `claude`
- it matches existing short internal names like `opencode`, `codex`, and `pi`
- it keeps CLI filters shorter and more natural

### Type updates

Likely changes in `src/types.ts`:

- add Claude agent kind
- add Claude runtime source/provider values such as:
  - `claude-hook`
  - `claude-preview`
  - `claude-command`
- extend provider/debug types as needed

### Runtime dispatch

Update runtime attachment so Claude panes do not flow through the OpenCode/Codex/Pi paths.

Likely shape:

- `src/core/claude.ts`
- runtime dispatcher handles Claude explicitly

## Fallback behavior

Like the other agents, Claude support should degrade safely.

### Preferred source

- Claude hook state file

### Fallback 1

- tmux pane preview heuristics

Possible preview heuristics:

- visible approval prompt
- visible numbered options
- visible trailing question in recent lines

### Fallback 2

- command-only classification

If the pane is running `claude` and no stronger signal is available:

- `status: "running"`
- `activity: "busy"`

## Install / tmux plugin integration

Claude support should fit into a more general tmux-plugin install selection model instead of adding yet another Claude-specific on/off switch.

### Recommended install configuration model

Keep the existing per-integration toggles working for compatibility, but add a higher-level tmux option that controls what the plugin should auto-install.

Suggested shape:

- `@coding-agents-tmux-auto-install 'auto'`
  - install every supported integration
- `@coding-agents-tmux-auto-install 'off'`
  - install nothing automatically
- `@coding-agents-tmux-auto-install 'opencode,pi,codex,claude'`
  - install only the listed integrations

This gives users the control they want:

- `auto` for the current “just set everything up for me” behavior
- an explicit list when they only want some integrations managed
- `off` when they want to manage everything manually

### Claude-specific recommendation

For Claude specifically, the tmux plugin should support auto-install, but it should participate in that shared selector rather than introducing a one-off policy.

Recommended first-pass behavior:

- add `claude` to the supported values of the shared auto-install selector
- keep `install-claude` as the explicit manual command
- if we need a Claude-specific escape hatch for compatibility later, treat it as a secondary override rather than the primary UX

### Safety note

Claude auto-install is still more invasive than Pi extension symlinks or the OpenCode plugin symlink because it edits `~/.claude/settings.json`.

So even if `auto` includes `claude`, the implementation should still be conservative:

- idempotent merges only
- preserve unrelated user settings and hooks
- make it easy to opt out by switching to `off` or an explicit list that omits `claude`

## Recommendation

For the first Claude Code iteration:

- implement `install-claude`
- document it in README
- plan a shared tmux plugin install selector with `auto | off | <list>` semantics
- wire Claude into that shared selector instead of adding a standalone Claude-only toggle

## Suggested implementation phases

### Phase 0: planning and research

- [x] Confirm Claude Code supports lifecycle hooks
- [x] Confirm Claude Code plugins can ship hooks
- [x] Confirm waiting/running/idle states are derivable from documented events
- [x] Write this plan

### Phase 1: core model and pane detection

- [ ] Add Claude agent kind to `src/types.ts`
- [ ] Add Claude runtime source/provider values
- [ ] Add Claude pane detection in `src/core/tmux.ts`
- [ ] Update CLI help and validation to include Claude

### Phase 2: hook-backed state ingestion

- [ ] Add `src/core/claude.ts`
- [ ] Add Claude state file reader/writer helpers
- [ ] Add `claude-hook-state` CLI command
- [ ] Map documented hook events to normalized runtime status
- [ ] Remove state files on `SessionEnd`

### Phase 3: install/template support

- [ ] Add `claude-hooks-template` CLI command
- [ ] Add `install-claude` CLI command
- [ ] Implement JSON merge/update logic for `~/.claude/settings.json`
- [ ] Keep install idempotent and preserve unrelated user hooks
- [ ] Design a shared tmux-plugin auto-install selector with `auto | off | <list>` semantics
- [ ] Make `claude` one of the supported values in that selector

### Phase 4: runtime attachment and fallback

- [ ] Attach Claude runtime to discovered panes
- [ ] Add preview-based waiting heuristics
- [ ] Add command-only Claude fallback
- [ ] Ensure mixed-agent environments still render cleanly

### Phase 5: tests

Add or extend tests for:

- [ ] Claude pane detection
- [ ] Claude hook payload classification
- [ ] settings.json merge/install behavior
- [ ] shared tmux auto-install selector parsing for `auto`, `off`, and explicit lists
- [ ] state matching by target / pane id / cwd fallback
- [ ] preview override behavior
- [ ] CLI help / filtering for `--agent claude`

Suggested files:

- `test/tmux.test.ts`
- new `test/claude.test.ts`
- `test/cli.test.ts`
- render/status tests for mixed environments

### Phase 6: documentation

- [ ] Update `README.md` with Claude Code support
- [ ] Document `install-claude`
- [ ] Document template usage for `.claude/settings.json`
- [ ] Document the shared tmux auto-install selector and how `claude` participates in it
- [ ] Document limitations and fallback behavior
- [ ] Document whether automatic install is supported or intentionally manual

### Phase 7: optional plugin packaging

- [ ] Prototype a Claude Code plugin directory in this repo
- [ ] Mirror the standalone managed hooks into `hooks/hooks.json`
- [ ] Validate dev flow with `claude --plugin-dir`
- [ ] Decide whether plugin packaging should be shipped for users or kept as a future enhancement

## Risks and open questions

### 1. Settings merge safety

Unlike Codex, Claude hooks live inside a broader settings JSON file.

Risk:

- install logic could accidentally damage or duplicate unrelated user config

Mitigation:

- keep managed hook groups clearly identifiable
- make merge logic idempotent
- preserve unknown fields exactly
- support a template command even if users avoid auto-install

### 2. Waiting-state fidelity

Some Claude waiting states will be explicit, some heuristic.

Mitigation:

- prioritize explicit waiting sources first:
  - `AskUserQuestion`
  - `PermissionRequest`
  - `Elicitation`
- use `Stop` message text only as a fallback classifier

### 3. Plugin install story may be more complex than hooks

Even though Claude plugins support hooks, plugin installation may not be the best first UX for this repo.

Mitigation:

- treat plugin packaging as a later distribution layer, not a blocker

### 4. Agent naming

Need to decide whether CLI/user-facing naming should be:

- `claude`
- `claude-code`

Recommendation remains:

- internal `claude`
- user-facing `Claude Code`

## Final recommendation

Implement Claude Code support using a **Codex-style hook ingestion architecture** first.

That means:

- **yes**, Claude Code can support the same overall lifecycle-hook pattern we need
- **yes**, Claude Code can later package that integration as a plugin
- but **no**, plugin packaging should not be the first milestone

The practical first implementation should be:

- tmux pane detection for Claude Code
- a Claude-specific runtime reader/writer
- a `claude-hook-state` ingest command
- generated/installed Claude hook configuration
- normalized `claude-state` files consumed by the existing tmux UI

That gets real support landed quickly while leaving room for a future Claude plugin wrapper if we want the more “extension-like” distribution story later.
