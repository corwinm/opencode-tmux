import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDetailLines,
  buildListLayout,
  filterPanes,
  formatQueryLine,
  getSelectionIndex,
  matchesQuery,
  renderListHeader,
  renderListRow,
} from "../src/cli/popup.ts";
import type {
  PaneRuntimeSummary,
  RuntimeInfo,
  RuntimeStatus,
  SessionMatch,
  TmuxPane,
} from "../src/types.ts";

function createPane(overrides: Partial<TmuxPane> = {}): TmuxPane {
  const sessionName = overrides.sessionName ?? "work";
  const windowIndex = overrides.windowIndex ?? 1;
  const paneIndex = overrides.paneIndex ?? 0;

  return {
    sessionName,
    windowIndex,
    paneIndex,
    paneId: overrides.paneId ?? `%${paneIndex + 1}`,
    paneTitle: overrides.paneTitle ?? "OpenCode",
    currentCommand: overrides.currentCommand ?? "opencode",
    currentPath: overrides.currentPath ?? "/tmp/project",
    isActive: overrides.isActive ?? false,
    tty: overrides.tty ?? "/dev/ttys001",
    target: overrides.target ?? `${sessionName}:${windowIndex}.${paneIndex}`,
  };
}

function createRuntime(
  status: RuntimeStatus,
  overrides: Partial<RuntimeInfo> = {},
  session: SessionMatch | null = null,
): RuntimeInfo {
  const activity =
    status === "running" || status === "waiting-question" || status === "waiting-input"
      ? "busy"
      : status === "unknown"
        ? "unknown"
        : "idle";

  return {
    activity,
    status,
    source: "plugin-exact",
    match: {
      strategy: "exact",
      provider: "plugin",
      heuristic: false,
    },
    session,
    detail: `runtime:${status}`,
    ...overrides,
  };
}

function createSummary(
  status: RuntimeStatus,
  overrides: Partial<PaneRuntimeSummary> = {},
): PaneRuntimeSummary {
  const pane = overrides.pane ?? createPane();

  return {
    pane,
    detection: overrides.detection ?? {
      isOpencode: true,
      confidence: "high",
      reasons: ["title:OpenCode", "command:opencode"],
    },
    runtime: overrides.runtime ?? createRuntime(status),
  };
}

test("matchesQuery and filterPanes search across target, status, session, title, and path", () => {
  const waitingPane = createSummary("waiting-question", {
    pane: createPane({
      target: "work:1.2",
      paneIndex: 2,
      paneTitle: "Review agent",
      currentPath: "/tmp/customer-project",
    }),
    runtime: createRuntime(
      "waiting-question",
      {},
      {
        id: "sess-1",
        directory: "/tmp/customer-project",
        title: "Customer Portal",
        timeUpdated: 0,
      },
    ),
  });
  const idlePane = createSummary("idle", {
    pane: createPane({ target: "work:1.3", paneIndex: 3, paneTitle: "Shell" }),
  });

  assert.equal(matchesQuery(waitingPane, "work:1.2 waiting customer review"), true);
  assert.equal(matchesQuery(waitingPane, "customer missing-token"), false);
  assert.deepEqual(
    filterPanes([waitingPane, idlePane], "customer waiting").map((entry) => entry.pane.target),
    ["work:1.2"],
  );
  assert.deepEqual(
    filterPanes([waitingPane, idlePane], "").map((entry) => entry.pane.target),
    ["work:1.2", "work:1.3"],
  );
});

test("formatQueryLine truncates long queries and reports a visible cursor column", () => {
  const short = formatQueryLine("busy panes", 50, 2, 7);
  const long = formatQueryLine("a very long query string that should scroll to the end", 24, 9, 12);

  assert.match(short.line, /> busy panes/);
  assert.match(short.line, /2\/7$/);
  assert.ok(short.cursorColumn > 2);
  assert.match(long.line, /^> \.{3}/);
  assert.match(long.line, /9\/12$/);
  assert.ok(long.cursorColumn <= 24);
});

test("buildListLayout keeps widths within their documented bounds", () => {
  const narrow = buildListLayout(40, 1);
  const wide = buildListLayout(120, 2);

  assert.equal(narrow.targetWidth >= 14, true);
  assert.equal(narrow.sessionWidth >= 12, true);
  assert.equal(narrow.titleWidth >= 12, true);
  assert.equal(wide.targetWidth <= 26, true);
  assert.equal(wide.sessionWidth <= 20, true);
});

test("renderListHeader and renderListRow produce readable rows and highlight selection", () => {
  const pane = createSummary("waiting-input", {
    pane: createPane({
      target: "work:1.7",
      paneIndex: 7,
      paneTitle: "A long title for popup rendering",
    }),
    runtime: createRuntime(
      "waiting-input",
      {},
      { id: "sess-1", directory: "/tmp/project", title: "Popup Session", timeUpdated: 0 },
    ),
  });

  const header = renderListHeader(60, 1).join("\n");
  const unselected = renderListRow(pane, 1, false, 60, 1);
  const selected = renderListRow(pane, 1, true, 60, 1);

  assert.match(header, /TARGET/);
  assert.match(unselected, /work:1\.7/);
  assert.match(unselected, /Popup Ses\.\.\./);
  assert.equal(selected.includes("\u001b[48;5;236m"), true);
  assert.equal(selected.includes("\u001b[38;5;196m> "), true);
});

test("buildDetailLines handles no selection, loading, preview errors, and cached previews", () => {
  const pane = createSummary("running", {
    pane: createPane({ target: "work:1.5", paneIndex: 5 }),
    runtime: createRuntime(
      "running",
      {},
      { id: "sess-1", directory: "/tmp/project", title: "Preview Session", timeUpdated: 0 },
    ),
  });

  assert.deepEqual(
    buildDetailLines(null, { error: null, lines: [], loading: false, target: null }, 40, 6),
    ["No matching panes."],
  );
  assert.match(
    buildDetailLines(
      pane,
      { error: null, lines: [], loading: true, target: pane.pane.target },
      40,
      6,
    )[1] ?? "",
    /Loading preview/,
  );
  assert.match(
    buildDetailLines(
      pane,
      { error: "tmux failed", lines: [], loading: false, target: pane.pane.target },
      40,
      6,
    )[1] ?? "",
    /tmux failed/,
  );
  assert.deepEqual(
    buildDetailLines(
      pane,
      {
        error: null,
        lines: ["line 1", "line 2", "line 3"],
        loading: false,
        target: pane.pane.target,
      },
      40,
      6,
    ).slice(1),
    ["line 1", "line 2", "line 3"],
  );
});

test("getSelectionIndex keeps the current selection when available and falls back to zero", () => {
  const panes = [
    createSummary("idle", { pane: createPane({ target: "work:1.0" }) }),
    createSummary("running", { pane: createPane({ target: "work:1.1", paneIndex: 1 }) }),
  ];

  assert.equal(getSelectionIndex(panes, "work:1.1"), 1);
  assert.equal(getSelectionIndex(panes, "work:9.9"), 0);
  assert.equal(getSelectionIndex(panes, null), 0);
});
