import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("registry core validator accepts the checked-in registry", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-agent-registry.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Agent registry valid:/);
});

test("registry JSON parses and declares unique agent ids", async () => {
  const registry = JSON.parse(await readFile(resolve(root, "agents/registry.json"), "utf8"));
  const ids = registry.agents.map(agent => agent.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 0);
  assert.equal(registry.schemaVersion, "1.1.0");
  assert.ok(registry.agents.every(agent => agent.runtime?.provider === "claude-code"));
});
