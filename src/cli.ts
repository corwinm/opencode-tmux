#!/usr/bin/env bun

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { renderInspectResult, renderPaneTable, renderSwitchChoices } from "./cli/render";
import { attachRuntimeToPanes } from "./core/opencode";
import { discoverOpencodePanes, findDiscoveredPaneByTarget, switchToPane } from "./core/tmux";
import type { InspectResult, PaneFilterOptions, PaneRuntimeSummary, PaneTarget } from "./types";

interface ListOptions extends PaneFilterOptions {
  json?: boolean;
  interval?: string;
  watch?: boolean;
}

interface InspectOptions {
  json?: boolean;
}

interface SwitchOptions extends PaneFilterOptions {}

async function loadPaneRuntimeSummaries() {
  const panes = await discoverOpencodePanes();
  return attachRuntimeToPanes(panes);
}

function parseWatchInterval(value: string | undefined): number {
  if (!value) {
    return 2;
  }

  const interval = Number(value);

  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`Invalid watch interval: ${value}`);
  }

  return interval;
}

function renderListOutput(panes: PaneRuntimeSummary[], json: boolean | undefined): string {
  if (json) {
    return JSON.stringify(panes, null, 2);
  }

  return renderPaneTable(panes);
}

function clearScreen(): void {
  output.write("\u001Bc");
}

async function watchListCommand(options: ListOptions): Promise<void> {
  const intervalSeconds = parseWatchInterval(options.interval);

  if (!output.isTTY) {
    throw new Error("Watch mode requires a TTY");
  }

  for (;;) {
    const panesWithRuntime = filterPaneSummaries(await loadPaneRuntimeSummaries(), options);
    clearScreen();
    console.log(`opencode-tmux list --watch (${new Date().toLocaleTimeString()})`);
    console.log(`refresh every ${intervalSeconds}s`);
    console.log();
    console.log(renderListOutput(panesWithRuntime, options.json));
    await Bun.sleep(intervalSeconds * 1000);
  }
}

function filterPaneSummaries(panes: PaneRuntimeSummary[], options: PaneFilterOptions): PaneRuntimeSummary[] {
  return panes.filter((entry) => {
    if (options.active && !entry.pane.isActive) {
      return false;
    }

    if (options.waiting && !["waiting-question", "waiting-input"].includes(entry.runtime.status)) {
      return false;
    }

    if (options.busy && !["running", "waiting-question", "waiting-input"].includes(entry.runtime.status)) {
      return false;
    }

    if (options.running && entry.runtime.status !== "running") {
      return false;
    }

    return true;
  });
}

async function runListCommand(options: ListOptions): Promise<void> {
  const panesWithRuntime = filterPaneSummaries(await loadPaneRuntimeSummaries(), options);

  if (options.watch) {
    await watchListCommand(options);
    return;
  }

  console.log(renderListOutput(panesWithRuntime, options.json));
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

async function runSwitchFilteredCommand(target: string | undefined, options: SwitchOptions): Promise<void> {
  const panes = filterPaneSummaries(await loadPaneRuntimeSummaries(), options);

  if (panes.length === 0) {
    throw new Error("No discovered opencode panes match the requested filters");
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
    .option("--watch", "Continuously refresh pane status")
    .option("--interval <seconds>", "Watch refresh interval in seconds", "2")
    .option("--active", "Only include active tmux panes")
    .option("--waiting", "Only include panes waiting for question or freeform input")
    .option("--busy", "Only include panes that are running or waiting for user response")
    .option("--running", "Only include panes with runtime status 'running'")
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
    .option("--active", "Only allow active tmux panes as candidates")
    .option("--waiting", "Only allow panes waiting for question or freeform input as candidates")
    .option("--busy", "Only allow panes that are running or waiting for user response as candidates")
    .option("--running", "Only allow panes with runtime status 'running' as candidates")
    .action(runSwitchFilteredCommand);

  await program.parseAsync(Bun.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`opencode-tmux: ${message}`);
  process.exit(1);
});
