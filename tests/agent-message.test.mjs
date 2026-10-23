import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { validateAgentMessage } from "../scripts/agent-message-core.mjs";

const root = REPOSITORY_ROOT;
const cliPath = resolve(root, "scripts/validate-agent-message.mjs");
const taskMessage = {
  messageVersion: "1.0.0",
  messageId: "msg-1001",
  correlationId: "flow-auth-01",
  taskId: "task-auth-01",
  sentAt: "2026-10-23T10:30:00Z",
  senderId: "byval",
  recipientId: "sam",
  type: "task",
  payload: {
    description: "Research authentication options",
    expectedOutput: "A concise Markdown comparison",
    acceptanceCriteria: ["Compare at least two options using repository evidence"],
    relevantContext: ["README.md"],
  },
};

async function getRegistry() {
  return (await loadValidatedRegistry()).registry;
}

test("validates a task message and returns a normalized delivery plan", async () => {
  const result = validateAgentMessage({ registry: await getRegistry(), message: taskMessage });
  assert.equal(result.message.messageVersion, "1.0.0");
  assert.equal(result.message.sender.id, "byval");
  assert.equal(result.message.recipient.id, "sam");
  assert.equal(result.message.type, "task");
  assert.deepEqual(result.message.payload.acceptanceCriteria, taskMessage.payload.acceptanceCriteria);
  assert.deepEqual(result.deliveryPlan, {
    recipientAgentId: "sam",
    status: "validated_not_dispatched",
  });
});

test("normalizes message identifiers, text, and timestamps", async () => {
  const message = {
    ...taskMessage,
    messageId: " msg-1002 ",
    sentAt: "2026-10-23T17:30:00+07:00",
    payload: { ...taskMessage.payload, description: "  Research authentication options  " },
  };
  const result = validateAgentMessage({ registry: await getRegistry(), message });
  assert.equal(result.message.messageId, "msg-1002");
  assert.equal(result.message.sentAt, "2026-10-23T10:30:00.000Z");
  assert.equal(result.message.payload.description, "Research authentication options");
});

test("rejects missing and unsupported envelope fields", async () => {
  const registry = await getRegistry();
  const { messageId, ...missingId } = taskMessage;
  assert.throws(
    () => validateAgentMessage({ registry, message: missingId }),
    /missing required field\(s\): messageId/,
  );
  assert.throws(
    () => validateAgentMessage({
      registry,
      message: { ...taskMessage, privileged: true },
    }),
    /contains unsupported field\(s\): privileged/,
  );
});

test("rejects unsupported protocol versions, message types, and malformed IDs", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, messageVersion: "2.0.0" } }),
    /messageVersion must be 1.0.0/,
  );
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, type: "broadcast" } }),
    /type must be one of/,
  );
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, taskId: "task id with spaces" } }),
    /taskId must be a 1-128 character identifier/,
  );
});

test("rejects invalid timestamps and self-messaging", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, sentAt: "yesterday" } }),
    /sentAt must be a valid ISO-8601 timestamp with a timezone/,
  );
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, recipientId: "byval" } }),
    /cannot send a message to itself/,
  );
});

test("rejects unknown and disabled senders or recipients", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateAgentMessage({ registry, message: { ...taskMessage, senderId: "unknown-agent" } }),
    /Unknown sender agent id: unknown-agent/,
  );
  const disabled = structuredClone(registry);
  disabled.agents.find((agent) => agent.id === "sam").enabled = false;
  assert.throws(
    () => validateAgentMessage({ registry: disabled, message: taskMessage }),
    /Recipient agent "sam" is disabled/,
  );
});

test("task messages must satisfy registry delegation policy", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateAgentMessage({
      registry,
      message: { ...taskMessage, senderId: "sam", recipientId: "jarvis" },
    }),
    /Parent agent "sam" is not permitted to delegate/,
  );
  const restricted = structuredClone(registry);
  restricted.agents.find((agent) => agent.id === "byval").delegation.allowedTargets = ["chloe"];
  assert.throws(
    () => validateAgentMessage({ registry: restricted, message: taskMessage }),
    /not allowed to delegate to "sam"/,
  );
});

test("validates result, status, error, and acknowledgement payloads", async () => {
  const registry = await getRegistry();
  const variants = [
    { type: "result", payload: { status: "completed", summary: "Research completed", output: "report.md", artifacts: ["report.md"] } },
    { type: "status", payload: { status: "in_progress", detail: "Comparing options" } },
    { type: "error", payload: { code: "TASK_BLOCKED", message: "Missing input", retryable: false } },
    { type: "ack", payload: { acknowledgedMessageId: "msg-1001" } },
  ];
  for (const variant of variants) {
    const result = validateAgentMessage({
      registry,
      message: { ...taskMessage, senderId: "sam", recipientId: "byval", ...variant },
    });
    assert.equal(result.message.type, variant.type);
    assert.equal(result.deliveryPlan.recipientAgentId, "byval");
  }
});

test("rejects malformed type-specific payloads and arbitrary payload fields", async () => {
  const registry = await getRegistry();
  assert.throws(
    () => validateAgentMessage({
      registry,
      message: { ...taskMessage, payload: { ...taskMessage.payload, runShell: "true" } },
    }),
    /payload contains unsupported field\(s\): runShell/,
  );
  assert.throws(
    () => validateAgentMessage({
      registry,
      message: { ...taskMessage, type: "error", payload: { code: "ERR", message: "no retry", retryable: "no" } },
    }),
    /payload.retryable must be a boolean/,
  );
  assert.throws(
    () => validateAgentMessage({
      registry,
      message: { ...taskMessage, type: "status", payload: { status: "unknown" } },
    }),
    /payload.status must be accepted, in_progress, completed, or blocked/,
  );
});

test("CLI emits a normalized delivery plan for a valid message file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "byv-agent-message-"));
  const filePath = join(dir, "message.json");
  try {
    await writeFile(filePath, JSON.stringify(taskMessage), "utf8");
    const result = spawnSync(process.execPath, [cliPath, filePath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.message.recipient.id, "sam");
    assert.equal(response.deliveryPlan.status, "validated_not_dispatched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects malformed JSON and extra arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "byv-agent-message-"));
  const filePath = join(dir, "message.json");
  try {
    await writeFile(filePath, "{ invalid json", "utf8");
    const invalidJson = spawnSync(process.execPath, [cliPath, filePath], { cwd: root, encoding: "utf8" });
    assert.notEqual(invalidJson.status, 0);
    assert.match(invalidJson.stderr, /Cannot read or parse message file/);

    const extraArgs = spawnSync(process.execPath, [cliPath, filePath, "unexpected"], { cwd: root, encoding: "utf8" });
    assert.notEqual(extraArgs.status, 0);
    assert.match(extraArgs.stderr, /Provide exactly one JSON file path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
