import assert from "node:assert/strict";
import test from "node:test";

import { runCommand, sleep } from "../src/runtime.ts";

test("runCommand captures stdout, stderr, and nonzero exit codes", async () => {
  const result = await runCommand([
    process.execPath,
    "-e",
    'process.stdout.write("hello"); process.stderr.write("warn"); process.exit(3);',
  ]);

  assert.equal(result.stdoutText, "hello");
  assert.equal(result.stderrText, "warn");
  assert.equal(result.exitCode, 3);
});

test("runCommand rejects when the process cannot be spawned", async () => {
  await assert.rejects(runCommand(["/definitely/missing/opencode-command"]));
});

test("sleep waits for at least the requested duration", async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15);
});
