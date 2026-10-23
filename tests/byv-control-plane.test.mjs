import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { createRunLedger, redactText } from "../scripts/byv-run-ledger-core.mjs";
import { createByvControlPlane, handleMcpRequest } from "../scripts/byv-mcp-server.mjs";

const pluginRoot = REPOSITORY_ROOT;
const registryPromise = loadValidatedRegistry({ root: pluginRoot });

async function createTempProject() {
  return mkdtemp(join(tmpdir(), "byv-p52-"));
}

async function createContext() {
  const { registry } = await registryPromise;
  return {
    provider: {
      profileId: "local-test-gateway",
      endpointHost: "localhost:20128",
      protocol: "anthropic-messages",
      modelId: "test-model",
      credentialSource: "auth-token",
    },
    registry: {
      generation: 1,
      registryId: registry.registryId,
      schemaVersion: registry.schemaVersion,
      digest: "a".repeat(64),
      snapshot: registry,
    },
  };
}

function oneTaskPlan(overrides = {}) {
  return [{
    taskId: "T-01",
    ownerAgentId: "byval",
    dependencies: [],
    scope: "Verify control-plane contract",
    files: ["docs/p5-mcp-control-plane.md"],
    acceptanceCriteria: [{ id: "AC-01", description: "The criterion is backed by observed evidence." }],
    ...overrides,
  }];
}

async function createActiveRun(ledger, overrides = {}) {
  return ledger.beginRun({
    executionMode: "sequential",
    ...(await createContext()),
    ...overrides,
  });
}

test("run ledger persists a completed run and enforces evidence-backed task transitions", async () => {
  const projectRoot = await createTempProject();
  try {
    const ledger = await createRunLedger({ projectRoot });
    const created = await createActiveRun(ledger);
    assert.equal(created.status, "in_progress");
    assert.equal(created.registry.digest, "a".repeat(64));
    assert.equal(created.provider.activeCredentialSourceVerified, false);
    assert.equal(JSON.stringify(created).includes("secret-value"), false);

    const planned = await ledger.recordPlan({ runId: created.runId, tasks: oneTaskPlan() });
    assert.equal(planned.tasks[0].status, "TODO");
    await assert.rejects(
      ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "DONE" }),
      /Invalid task transition/,
    );

    await ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "READY" });
    await ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "IN_PROGRESS" });
    await assert.rejects(
      ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "REVIEW" }),
      /handoff is recorded/,
    );
    await ledger.recordVerification({
      runId: created.runId,
      taskId: "T-01",
      criterionId: "AC-01",
      command: "node --test tests/byv-control-plane.test.mjs",
      outcome: "PASS",
      executed: true,
      summary: "The targeted test command passed.",
    });
    await ledger.recordHandoff({
      runId: created.runId,
      taskId: "T-01",
      summary: "Implementation and test evidence are ready for review.",
      changedFiles: ["scripts/byv-run-ledger-core.mjs"],
      unresolvedRisks: [],
      nextAction: "Review the PR.",
      evidenceRefs: ["local test run"],
    });
    await ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "REVIEW" });
    await ledger.updateTask({ runId: created.runId, taskId: "T-01", status: "DONE" });
    const finished = await ledger.finishRun({
      runId: created.runId,
      outcome: "DONE",
      summary: "All task acceptance criteria have passing executed evidence.",
    });
    assert.equal(finished.status, "done");
    assert.equal(finished.tasks[0].status, "DONE");
    assert.equal(finished.tasks[0].acceptanceCriteria[0].latestOutcome, "PASS");

    const restarted = await createRunLedger({ projectRoot });
    const restored = await restarted.getRunSummary({ runId: created.runId });
    assert.equal(restored.status, "done");
    assert.equal(restored.tasks[0].status, "DONE");
    assert.ok(restored.events.some((event) => event.event === "run.finished"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("task plan validation rejects unknown dependencies and cycles", async () => {
  const projectRoot = await createTempProject();
  try {
    const ledger = await createRunLedger({ projectRoot });
    const run = await createActiveRun(ledger);
    await assert.rejects(ledger.recordPlan({
      runId: run.runId,
      tasks: oneTaskPlan({ dependencies: ["T-99"] }),
    }), /unknown dependency/);

    await assert.rejects(ledger.recordPlan({
      runId: run.runId,
      tasks: [
        { ...oneTaskPlan()[0], taskId: "T-01", dependencies: ["T-02"] },
        { ...oneTaskPlan()[0], taskId: "T-02", dependencies: ["T-01"] },
      ],
    }), /dependency cycle/);

    const saved = await ledger.getRun(run.runId);
    assert.equal(saved.planRecorded, false);
    assert.equal(saved.tasks.length, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("dependencies must finish before a task becomes READY", async () => {
  const projectRoot = await createTempProject();
  try {
    const ledger = await createRunLedger({ projectRoot });
    const run = await createActiveRun(ledger);
    await ledger.recordPlan({
      runId: run.runId,
      tasks: [
        { ...oneTaskPlan()[0], taskId: "T-01", dependencies: [] },
        { ...oneTaskPlan()[0], taskId: "T-02", dependencies: ["T-01"] },
      ],
    });
    await assert.rejects(
      ledger.updateTask({ runId: run.runId, taskId: "T-02", status: "READY" }),
      /before dependency T-01 is DONE/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("interrupted in-flight tasks are marked BLOCKED and may be explicitly resumed", async () => {
  const projectRoot = await createTempProject();
  try {
    const first = await createRunLedger({ projectRoot });
    const run = await createActiveRun(first);
    await first.recordPlan({ runId: run.runId, tasks: oneTaskPlan() });
    await first.updateTask({ runId: run.runId, taskId: "T-01", status: "READY" });
    await first.updateTask({ runId: run.runId, taskId: "T-01", status: "IN_PROGRESS" });

    const recovered = await createRunLedger({ projectRoot, recoverAllActiveRuns: true });
    let summary = await recovered.getRunSummary({ runId: run.runId });
    assert.equal(summary.status, "interrupted");
    assert.equal(summary.tasks[0].status, "BLOCKED");
    assert.match(summary.tasks[0].blockReason, /outcome is unknown/);
    assert.equal(summary.recoveryCount, 1);

    summary = await recovered.resumeRun({ runId: run.runId, reason: "Operator inspected the interrupted run." });
    assert.equal(summary.status, "in_progress");
    await recovered.updateTask({ runId: run.runId, taskId: "T-01", status: "READY" });
    assert.equal((await recovered.getRunSummary({ runId: run.runId })).tasks[0].status, "READY");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ledger rejects storage paths outside the project and repository traversal file boundaries", async () => {
  const projectRoot = await createTempProject();
  try {
    await assert.rejects(
      createRunLedger({ projectRoot, storageDir: resolve(projectRoot, "..", "outside-ledger") }),
      /inside the configured project root/,
    );
    const ledger = await createRunLedger({ projectRoot });
    const run = await createActiveRun(ledger);
    await assert.rejects(
      ledger.recordPlan({ runId: run.runId, tasks: oneTaskPlan({ files: ["../secret.txt"] }) }),
      /must be repository-relative|unsafe path segment/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ledger redacts token-like values before storing or returning evidence", async () => {
  const projectRoot = await createTempProject();
  try {
    const ledger = await createRunLedger({ projectRoot });
    const run = await createActiveRun(ledger);
    await ledger.recordPlan({ runId: run.runId, tasks: oneTaskPlan() });
    await ledger.updateTask({ runId: run.runId, taskId: "T-01", status: "READY" });
    await ledger.updateTask({ runId: run.runId, taskId: "T-01", status: "IN_PROGRESS" });
    const raw = "Observed token sk-1234567890-secret and ANTHROPIC_AUTH_TOKEN=super-secret-value";
    await ledger.recordVerification({
      runId: run.runId,
      taskId: "T-01",
      criterionId: "AC-01",
      command: "echo sk-1234567890-secret",
      outcome: "FAIL",
      executed: true,
      summary: raw,
    });
    const output = JSON.stringify(await ledger.getRunSummary({ runId: run.runId }));
    const saved = await readFile(join(ledger.storageDirectory, run.runId + ".json"), "utf8");
    assert.equal(output.includes("1234567890-secret"), false);
    assert.equal(output.includes("super-secret-value"), false);
    assert.equal(saved.includes("1234567890-secret"), false);
    assert.equal(saved.includes("super-secret-value"), false);
    assert.match(redactText(raw), /REDACTED/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("concurrent run creation produces independent durable records", async () => {
  const projectRoot = await createTempProject();
  try {
    const ledger = await createRunLedger({ projectRoot });
    const runs = await Promise.all([
      createActiveRun(ledger),
      createActiveRun(ledger),
      createActiveRun(ledger),
    ]);
    assert.equal(new Set(runs.map((run) => run.runId)).size, 3);
    const list = await ledger.listRuns();
    assert.equal(list.length, 3);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("MCP control plane exposes expected tools, pins run registry, and redacts credentials", async () => {
  const projectRoot = await createTempProject();
  try {
    const env = {
      ANTHROPIC_BASE_URL: "http://localhost:20128/v1",
      ANTHROPIC_AUTH_TOKEN: "sk-test-secret-token-value",
      ANTHROPIC_MODEL: "byv-flash-2410",
      BYV_PROVIDER_PROTOCOL: "anthropic-messages",
      BYV_PROVIDER_PROFILE_ID: "local-test-gateway",
    };
    const control = await createByvControlPlane({ pluginRoot, projectRoot, env });
    const names = control.tools.map((item) => item.name);
    for (const name of [
      "byv_runtime_status", "byv_registry_status", "byv_reload_registry",
      "byv_prepare_agent", "byv_begin_run", "byv_record_plan", "byv_update_task",
      "byv_record_handoff", "byv_record_verification", "byv_finish_run",
      "byv_resume_run", "byv_get_run_summary",
    ]) assert.ok(names.includes(name), "Missing tool: " + name);

    const runtime = await control.callTool("byv_runtime_status", {});
    assert.equal(runtime.status, "configuration_preflight_passed");
    assert.equal(runtime.credentials.authTokenPresent, true);
    assert.equal(JSON.stringify(runtime).includes("sk-test-secret-token-value"), false);
    assert.equal(runtime.secretValuesReturned, false);

    const registry = await control.callTool("byv_registry_status", {});
    assert.equal(registry.agentCount, 5);
    assert.ok(/^[a-f0-9]{64}$/.test(registry.digest));

    const run = await control.callTool("byv_begin_run", { executionMode: "sequential" });
    assert.equal(run.status, "in_progress");
    assert.equal(run.provider.modelId, "byv-flash-2410");
    const stored = await control.ledger.getRun(run.runId);
    assert.equal(stored.registry.snapshot.schemaVersion, "1.1.0");
    assert.equal(JSON.stringify(stored).includes("sk-test-secret-token-value"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("MCP JSON-RPC initialize, list, and tool-call messages follow stdio contract", async () => {
  const projectRoot = await createTempProject();
  try {
    const control = await createByvControlPlane({
      pluginRoot,
      projectRoot,
      env: {
        ANTHROPIC_API_KEY: "sk-test-api-secret",
        ANTHROPIC_MODEL: "model-test",
      },
    });
    const initialized = await handleMcpRequest({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {} },
    }, control);
    assert.equal(initialized.result.protocolVersion, "2025-03-26");
    assert.equal(initialized.result.serverInfo.name, "byv-control-plane");

    const listed = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, control);
    assert.ok(listed.result.tools.length >= 10);

    const called = await handleMcpRequest({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "byv_registry_status", arguments: {} },
    }, control);
    assert.equal(called.result.isError, false);
    assert.match(called.result.content[0].text, /"agentCount": 5/);

    const error = await handleMcpRequest({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "unknown_tool", arguments: {} },
    }, control);
    assert.equal(error.error.code, -32601);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("MCP begin-run tool fails closed if API-only preflight is blocked", async () => {
  const projectRoot = await createTempProject();
  try {
    const control = await createByvControlPlane({ pluginRoot, projectRoot, env: {} });
    await assert.rejects(
      control.callTool("byv_begin_run", { executionMode: "sequential" }),
      /API-only preflight is blocked/,
    );
    assert.equal((await control.ledger.listRuns()).length, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("an active run continues to use its pinned registry after a successful reload", async () => {
  const projectRoot = await createTempProject();
  try {
    const control = await createByvControlPlane({
      pluginRoot,
      projectRoot,
      env: {
        ANTHROPIC_BASE_URL: "http://localhost:20128/v1",
        ANTHROPIC_AUTH_TOKEN: "sk-test-token-for-pinned-snapshot",
        ANTHROPIC_MODEL: "byv-flash-2410",
        BYV_PROVIDER_PROTOCOL: "anthropic-messages",
      },
    });
    const run = await control.callTool("byv_begin_run", { executionMode: "sequential" });
    const pinned = (await control.ledger.getRun(run.runId)).registry.snapshot;
    const priorDescription = pinned.agents.find((agent) => agent.id === "sam").description;
    const candidate = structuredClone(control.registryManager.getSnapshot().registry);
    candidate.agents.find((agent) => agent.id === "sam").description = "Reloaded description for future runs only";
    const active = await control.registryManager.reload(candidate, { source: "unit-test" });
    assert.equal(active.generation, 2);
    assert.notEqual(
      active.registry.agents.find((agent) => agent.id === "sam").description,
      priorDescription,
    );

    const packet = await control.callTool("byv_prepare_agent", {
      runId: run.runId,
      agentId: "sam",
      parentAgentId: "byval",
      task: "Review a small planning task",
      expectedOutput: "A concise plan",
      acceptanceCriteria: ["Include a testable outcome"],
    });
    assert.equal(packet.agent.description, priorDescription);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("bundled stdio server emits only valid JSON-RPC messages on stdout", async () => {
  const projectRoot = await createTempProject();
  try {
    const serverPath = resolve(pluginRoot, "scripts/byv-mcp-server.mjs");
    const input = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ].join("\n") + "\n";
    const result = spawnSync(process.execPath, [serverPath], {
      cwd: projectRoot,
      input,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        BYV_PLUGIN_ROOT: pluginRoot,
        BYV_PROJECT_ROOT: projectRoot,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 2, "expected one JSON-RPC response per request");
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.id, 1);
    assert.equal(first.result.serverInfo.name, "byv-control-plane");
    assert.equal(second.id, 2);
    assert.ok(second.result.tools.some((tool) => tool.name === "byv_begin_run"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a second control-plane instance does not interrupt a run owned by a live process", async () => {
  const projectRoot = await createTempProject();
  try {
    const first = await createRunLedger({ projectRoot });
    const run = await createActiveRun(first);
    const second = await createRunLedger({ projectRoot });
    const summary = await second.getRunSummary({ runId: run.runId });
    assert.equal(summary.status, "in_progress");
    assert.equal(summary.recoveryCount, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plugin MCP manifest registers the bundled server through CLAUDE_PLUGIN_ROOT", async () => {
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, ".mcp.json"), "utf8"));
  const server = manifest.mcpServers["byv-control-plane"];
  assert.equal(server.command, "node");
  assert.ok(server.args[0].includes("${CLAUDE_PLUGIN_ROOT}/scripts/byv-mcp-server.mjs"));
  assert.equal(server.env.BYV_PLUGIN_ROOT, "${CLAUDE_PLUGIN_ROOT}");
});
