import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { validateDelegationRequest } from "../scripts/delegation-core.mjs";

const root = REPOSITORY_ROOT;
const cliPath = resolve(root, "scripts/validate-delegation.mjs");
const request = {
  requestingAgentId: "byval",
  targetAgentId: "sam",
  taskPayload: {
    description: "Research existing authentication options.",
    expectedOutput: "A concise Markdown comparison.",
    acceptanceCriteria: ["Compare at least two options using repository evidence."],
    relevantContext: ["README.md"],
  },
};

async function getRegistry() {
  return (await loadValidatedRegistry()).registry;
}

test("allows registered delegation and returns a normalized task contract", async () => {
  const result = validateDelegationRequest({ registry: await getRegistry(), request });
  assert.equal(result.delegationVersion, "1.0.0");
  assert.equal(result.requester.id, "byval");
  assert.equal(result.target.id, "sam");
  assert.deepEqual(result.task.acceptanceCriteria, request.taskPayload.acceptanceCriteria);
  assert.deepEqual(result.task.relevantContext, ["README.md"]);
});

test("rejects an unknown requesting agent", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, requestingAgentId: "unknown-parent" },
    }),
    /Unknown parent agent id: unknown-parent/,
  );
});

test("rejects an unknown target agent", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, targetAgentId: "unknown-target" },
    }),
    /Unknown agent id: unknown-target/,
  );
});

test("rejects disabled requesting and target agents", async () => {
  const registry = await getRegistry();
  const disabledRequester = structuredClone(registry);
  disabledRequester.agents.find((agent) => agent.id === "byval").enabled = false;
  assert.throws(
    () => validateDelegationRequest({ registry: disabledRequester, request }),
    /Parent agent "byval" is disabled/,
  );

  const disabledTarget = structuredClone(registry);
  disabledTarget.agents.find((agent) => agent.id === "sam").enabled = false;
  assert.throws(
    () => validateDelegationRequest({ registry: disabledTarget, request }),
    /Agent "sam" is disabled/,
  );
});

test("rejects a requester without delegation permission", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, requestingAgentId: "sam", targetAgentId: "jarvis" },
    }),
    /Parent agent "sam" is not permitted to delegate/,
  );
});

test("rejects a target omitted from the requester's allowedTargets", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, targetAgentId: "not-allowed" },
    }),
    /Unknown agent id: not-allowed/,
  );

  const restrictedRegistry = structuredClone(registry);
  restrictedRegistry.agents.find((agent) => agent.id === "byval").delegation.allowedTargets = ["sam", "chloe", "morgan"];
  assert.throws(
    () => validateDelegationRequest({
      registry: restrictedRegistry,
      request: { ...request, targetAgentId: "jarvis" },
    }),
    /Parent agent "byval" is not allowed to delegate to "jarvis"/,
  );
});

test("rejects malformed task payload fields and empty acceptance criteria", async () => {
  const registry = await getRegistry();
  const { taskPayload } = request;

  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, taskPayload: { ...taskPayload, expectedOutput: " " } },
    }),
    /taskPayload.expectedOutput must be a non-empty string/,
  );
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, taskPayload: { ...taskPayload, acceptanceCriteria: [] } },
    }),
    /acceptanceCriteria must be a non-empty array/,
  );
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, taskPayload: { description: taskPayload.description } },
    }),
    /missing required field\(s\): expectedOutput, acceptanceCriteria/,
  );
});

test("rejects unsupported request and task payload fields", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: { ...request, elevatedPermissions: true },
    }),
    /delegation request contains unsupported field\(s\): elevatedPermissions/,
  );
  assert.throws(
    () => validateDelegationRequest({
      registry,
      request: {
        ...request,
        taskPayload: { ...request.taskPayload, arbitraryCommand: "run this" },
      },
    }),
    /taskPayload contains unsupported field\(s\): arbitraryCommand/,
  );
});

test("delegation CLI emits a valid contract for an allowed request", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "--requester", "byval",
    "--target", "sam",
    "--task", request.taskPayload.description,
    "--expected-output", request.taskPayload.expectedOutput,
    "--acceptance", request.taskPayload.acceptanceCriteria[0],
    "--context", "README.md",
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.requester.id, "byval");
  assert.equal(packet.target.id, "sam");
  assert.equal(packet.task.description, request.taskPayload.description);
});

test("delegation CLI rejects unsupported command-line options", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "--requester", "byval",
    "--target", "sam",
    "--task", request.taskPayload.description,
    "--expected-output", request.taskPayload.expectedOutput,
    "--acceptance", request.taskPayload.acceptanceCriteria[0],
    "--admin", "true",
  ], { cwd: root, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option: --admin/);
});
