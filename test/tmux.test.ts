import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSwitchToPaneCommand,
  detectOpencodePane,
  discoverOpencodePanesFromList,
  normalizeCapturedPaneLines,
  parseListAllPanesOutput,
  parsePaneLine,
} from "../src/core/tmux.ts";
import type { TmuxPane } from "../src/types.ts";

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

test("detectOpencodePane recognizes OC title prefixes, medium-confidence blends, and no-signal panes", () => {
  assert.deepEqual(
    detectOpencodePane(createPane({ paneTitle: "OC | reviewing", currentCommand: "bash" })),
    {
      isOpencode: true,
      confidence: "high",
      reasons: ["title:OC prefix"],
    },
  );

  assert.deepEqual(
    detectOpencodePane(
      createPane({
        paneTitle: "shell",
        currentCommand: "opencode",
        currentPath: "/tmp/opencode-scratch",
      }),
    ),
    {
      isOpencode: true,
      confidence: "medium",
      reasons: ["command:opencode", "path:opencode-like"],
    },
  );

  assert.deepEqual(
    detectOpencodePane(
      createPane({ paneTitle: "shell", currentCommand: "bash", currentPath: "/tmp/project" }),
    ),
    {
      isOpencode: false,
      confidence: "low",
      reasons: [],
    },
  );
});

test("parsePaneLine and parseListAllPanesOutput parse tmux rows and reject malformed output", () => {
  const line = [
    "work",
    "12",
    "3",
    "%9",
    "OpenCode",
    "opencode",
    "/tmp/project",
    "1",
    "/dev/ttys009",
  ].join("\t");

  assert.deepEqual(parsePaneLine(line), {
    sessionName: "work",
    windowIndex: 12,
    paneIndex: 3,
    paneId: "%9",
    paneTitle: "OpenCode",
    currentCommand: "opencode",
    currentPath: "/tmp/project",
    isActive: true,
    tty: "/dev/ttys009",
    target: "work:12.3",
  });

  assert.deepEqual(parseListAllPanesOutput(`${line}\n${line}\n`).length, 2);
  assert.throws(() => parsePaneLine("too\tfew\tfields"), /Unexpected tmux output/);
});

test("discoverOpencodePanesFromList filters non-opencode panes and sorts targets", () => {
  const panes = [
    createPane({ target: "work:2.1", windowIndex: 2, paneIndex: 1 }),
    createPane({
      target: "work:1.0",
      currentCommand: "bash",
      paneTitle: "shell",
      currentPath: "/tmp/project",
    }),
    createPane({ target: "work:1.2", paneIndex: 2 }),
  ];

  assert.deepEqual(
    discoverOpencodePanesFromList(panes).map((entry) => entry.pane.target),
    ["work:1.2", "work:2.1"],
  );
});

test("normalizeCapturedPaneLines strips ANSI escapes, expands tabs, and preserves internal blanks", () => {
  const raw = ["plain\ttext", "\u001b[31mred\u001b[0m", "", "   ", "tail", ""].join("\n");

  assert.deepEqual(normalizeCapturedPaneLines(raw), ["plain    text", "red", "", "", "tail"]);
});

test("buildSwitchToPaneCommand targets the pane correctly inside and outside tmux", () => {
  const pane = createPane({
    sessionName: "work",
    windowIndex: 4,
    paneIndex: 2,
    target: "work:4.2",
  });

  assert.deepEqual(buildSwitchToPaneCommand(pane, true), [
    "tmux",
    "switch-client",
    "-t",
    "work",
    ";",
    "select-window",
    "-t",
    "work:4",
    ";",
    "select-pane",
    "-t",
    "work:4.2",
  ]);
  assert.deepEqual(buildSwitchToPaneCommand(pane, false), [
    "tmux",
    "attach-session",
    "-t",
    "work",
    ";",
    "select-window",
    "-t",
    "work:4",
    ";",
    "select-pane",
    "-t",
    "work:4.2",
  ]);
});
