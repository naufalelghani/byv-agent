import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  loadValidatedRegistry,
  REPOSITORY_ROOT,
  validateRegistryData,
} from "../scripts/agent-registry-core.mjs";
import { createBootstrapPacket } from "../scripts/bootstrap-agent.mjs";

const root = REPOSITORY_ROOT;
const scriptPath = resolve(root, "scripts/bootstrap-agent.mjs");
const assignment = {
  task: "Review the current frontend profile and return a brief summary.",
  expectedOutput: "A concise Markdown summary.",
  acceptanceCriteria: ["The summary contains findings grounded in the registered profile."],
  relevantContext: ["README.md"],
};

test("registry loader validates the checked-in registry", async () => {
  const { registry } = await loadValidatedRegistry();
  assert.equal(registry.registryId, "byv-agent-registry");
  assert.equal(registry.agents.length, 5);
});

test("bootstrap CLI includes identity, policy, task, and the registered profile", () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--agent", "sam",
    "--parent", "byval",
    "--task", assignment.task,
    "--expected-output", assignment.expectedOutput,
    "--acceptance", assignment.acceptanceCriteria[0],
    "--context", "README.md",
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.registry.id, "byv-agent-registry");
  assert.equal(packet.agent.id, "sam");
  assert.deepEqual(packet.agent.runtime, { provider: "claude-code", kind: "custom-agent", agentDefinition: "planning-research" });
  assert.equal(packet.parentAgentId, "byval");
  assert.equal(packet.profile.path, "agents/planning-research.md");
  assert.match(packet.profile.content, /Sam|Planning|Research/i);
  assert.equal(packet.permissions.sourceAccess, "read-only");
  assert.deepEqual(packet.task.acceptanceCriteria, assignment.acceptanceCriteria);
});

test("bootstrap rejects unknown agent IDs", () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--agent", "not-registered",
    "--parent", "byval",
    "--task", assignment.task,
    "--expected-output", assignment.expectedOutput,
    "--acceptance", assignment.acceptanceCriteria[0],
  ], { cwd: root, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown agent id: not-registered/);
});

test("bootstrap rejects a disabled target agent", async () => {
  const { registry } = await loadValidatedRegistry();
  const candidate = structuredClone(registry);
  candidate.agents.find((agent) => agent.id === "sam").enabled = false;

  await assert.rejects(
    createBootstrapPacket({
      registry: candidate,
      root,
      agentId: "sam",
      parentAgentId: "byval",
      ...assignment,
    }),
    /Agent "sam" is disabled/,
  );
});

test("bootstrap rejects a parent that has no delegation permission", async () => {
  const { registry } = await loadValidatedRegistry();
  await assert.rejects(
    createBootstrapPacket({
      registry,
      root,
      agentId: "chloe",
      parentAgentId: "sam",
      ...assignment,
    }),
    /Parent agent "sam" is not permitted to delegate/,
  );
});

test("registry validation fails closed on unsupported schema versions", async () => {
  const { registry, schema } = await loadValidatedRegistry();
  const candidate = structuredClone(registry);
  candidate.schemaVersion = "9.9.9";

  await assert.rejects(
    validateRegistryData(candidate, schema, root),
    /Unsupported schemaVersion/,
  );
});
