#!/usr/bin/env bun

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { renderInspectResult, renderPaneTable, renderSwitchChoices } from "./cli/render";
import { attachRuntimeToPanes } from "./core/opencode";
import { discoverOpencodePanes, findDiscoveredPaneByTarget, switchToPane } from "./core/tmux";
import type { InspectResult, PaneRuntimeSummary, PaneTarget } from "./types";

interface ListOptions {
  json?: boolean;
}

interface InspectOptions {
  json?: boolean;
}

async function loadPaneRuntimeSummaries() {
  const panes = await discoverOpencodePanes();
  return attachRuntimeToPanes(panes);
}

async function runListCommand(options: ListOptions): Promise<void> {
  const panesWithRuntime = await loadPaneRuntimeSummaries();

  if (options.json) {
    console.log(JSON.stringify(panesWithRuntime, null, 2));
    return;
  }

  console.log(renderPaneTable(panesWithRuntime));
}

async function runInspectCommand(target: string, options: InspectOptions): Promise<void> {
  const panes = await discoverOpencodePanes();
  const pane = findDiscoveredPaneByTarget(panes, target as PaneTarget);

  if (!pane) {
    throw new Error(`No discovered opencode pane matches target ${target}`);
  }

  const summary = attachRuntimeToPanes([pane])[0];

  if (!summary) {
    throw new Error(`Failed to inspect target ${target}`);
  }

  const result: InspectResult = {
    target: summary.pane.target,
    summary,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderInspectResult(result));
}

function requirePaneByTarget(panes: PaneRuntimeSummary[], target: string): PaneRuntimeSummary {
  const pane = panes.find((entry) => entry.pane.target === target);

  if (!pane) {
    throw new Error(`No discovered opencode pane matches target ${target}`);
  }

  return pane;
}

async function promptForPaneSelection(panes: PaneRuntimeSummary[]): Promise<PaneRuntimeSummary> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Interactive switch requires a TTY. Pass an explicit target instead.");
  }

  console.log(renderSwitchChoices(panes));

  const rl = createInterface({ input, output });

  try {
    const answer = (await rl.question("\nEnter selection number or target: ")).trim();

    if (!answer) {
      throw new Error("No selection provided");
    }

    const index = Number(answer);

    if (Number.isInteger(index) && index >= 1 && index <= panes.length) {
      const pane = panes[index - 1];

      if (!pane) {
        throw new Error(`Invalid selection: ${answer}`);
      }

      return pane;
    }

    return requirePaneByTarget(panes, answer);
  } finally {
    rl.close();
  }
}

async function runSwitchCommand(target?: string): Promise<void> {
  const panes = await loadPaneRuntimeSummaries();

  if (panes.length === 0) {
    throw new Error("No discovered opencode panes available to switch to");
  }

  const pane = target ? requirePaneByTarget(panes, target) : await promptForPaneSelection(panes);

  await switchToPane(pane.pane);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("opencode-tmux")
    .description("CLI tooling for discovering and navigating opencode sessions running in tmux")
    .showHelpAfterError();

  program
    .command("list")
    .description("List likely opencode tmux panes")
    .option("--json", "Print machine-readable JSON")
    .action(runListCommand);

  program
    .command("inspect")
    .description("Inspect one discovered opencode tmux pane")
    .argument("<target>", "Pane target in session:window.pane format")
    .option("--json", "Print machine-readable JSON")
    .action(runInspectCommand);

  program
    .command("switch")
    .description("Switch tmux to one discovered opencode pane")
    .argument("[target]", "Pane target in session:window.pane format")
    .action(runSwitchCommand);

  await program.parseAsync(Bun.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`opencode-tmux: ${message}`);
  process.exit(1);
});
