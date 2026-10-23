#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadValidatedRegistry } from "./agent-registry-core.mjs";
import { createRegistryManager } from "./agent-registry-runtime.mjs";
import { createBootstrapPacket } from "./bootstrap-agent.mjs";
import { inspectApiOnlyEnvironment } from "./byv-runtime-doctor.mjs";
import { createRunLedger, redactText } from "./byv-run-ledger-core.mjs";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_NAME = "byv-control-plane";
const SERVER_VERSION = "0.1.0";
const JSON_SCHEMA_OBJECT = { type: "object", properties: {}, additionalProperties: false };

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label = "arguments") {
  if (!isObject(value)) throw new Error(label + " must be an object");
  return value;
}

function exactArgs(args, allowed, required = []) {
  requireObject(args);
  const unsupported = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unsupported.length) throw new Error("Unsupported argument(s): " + unsupported.join(", "));
  const missing = required.filter((key) => !Object.hasOwn(args, key));
  if (missing.length) throw new Error("Missing required argument(s): " + missing.join(", "));
}

function digestJson(value) {
  function stable(input) {
    if (Array.isArray(input)) return "[" + input.map(stable).join(",") + "]";
    if (isObject(input)) {
      return "{" + Object.keys(input).sort().map((key) =>
        JSON.stringify(key) + ":" + stable(input[key])).join(",") + "}";
    }
    return JSON.stringify(input);
  }
  return createHash("sha256").update(stable(value)).digest("hex");
}

function snapshotSummary(snapshot, audit = null) {
  return {
    valid: true,
    generation: snapshot.generation,
    activatedAt: snapshot.activatedAt,
    registryId: snapshot.registryId,
    schemaVersion: snapshot.schemaVersion,
    digest: snapshot.registryDigest,
    agentCount: snapshot.registry.agents.length,
    agentIds: snapshot.registry.agents.map((agent) => agent.id),
    latestAudit: audit && audit.length ? audit[audit.length - 1] : null,
  };
}

function stringArraySchema(description) {
  return { type: "array", items: { type: "string", minLength: 1 }, maxItems: 100, description };
}

const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskId: { type: "string", minLength: 1, maxLength: 80 },
    ownerAgentId: { type: "string", minLength: 1, maxLength: 80 },
    dependencies: stringArraySchema("Task IDs that must finish first."),
    scope: { type: "string", minLength: 1, maxLength: 2000 },
    files: stringArraySchema("Repository-relative file boundaries. Do not use absolute paths or parent traversal."),
    acceptanceCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", minLength: 1, maxLength: 1500 },
        },
        required: ["id", "description"],
      },
    },
  },
  required: ["taskId", "ownerAgentId", "dependencies", "scope", "files", "acceptanceCriteria"],
};

const TOOLS = [
  {
    name: "byv_runtime_status",
    description: "Report API-only configuration readiness and redacted provider metadata. Does not contact a provider or prove the active credential source.",
    inputSchema: JSON_SCHEMA_OBJECT,
  },
  {
    name: "byv_registry_status",
    description: "Validate and report the active in-process registry generation, SHA-256 digest, and agent IDs.",
    inputSchema: JSON_SCHEMA_OBJECT,
  },
  {
    name: "byv_reload_registry",
    description: "Read agents/registry.json from the bundled plugin root, validate it against the pinned schema, and activate only a valid changed candidate. Failed reloads preserve the active snapshot.",
    inputSchema: JSON_SCHEMA_OBJECT,
  },
  {
    name: "byv_prepare_agent",
    description: "Validate a registered agent bootstrap packet using either the active registry or a run's pinned registry snapshot. Prepares context only; it does not spawn an agent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string", minLength: 1 },
        parentAgentId: { type: "string", minLength: 1 },
        task: { type: "string", minLength: 1, maxLength: 2000 },
        expectedOutput: { type: "string", minLength: 1, maxLength: 1000 },
        acceptanceCriteria: { ...stringArraySchema("Verifiable acceptance criteria."), minItems: 1 },
        relevantContext: stringArraySchema("Relevant file paths, decisions, interfaces, or constraints."),
        runId: { type: "string", description: "Optional run ID pins bootstrap policy to that run's registry snapshot." },
      },
      required: ["agentId", "task", "expectedOutput", "acceptanceCriteria"],
    },
  },
  {
    name: "byv_begin_run",
    description: "Create a durable run record after API-only preflight passes. Pins the selected provider/model metadata and validated registry snapshot; never stores credentials.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        executionMode: {
          type: "string",
          enum: ["unselected", "native-agent-teams", "custom-subagents", "sequential"],
          description: "Execution path selected for this run. Selecting a mode is not proof that spawning actually occurred.",
        },
      },
      required: ["executionMode"],
    },
  },
  {
    name: "byv_record_plan",
    description: "Persist one canonical task plan with owners, dependencies, file boundaries, and acceptance criteria. Task IDs must be unique and dependencies acyclic.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        tasks: { type: "array", minItems: 1, maxItems: 100, items: TASK_SCHEMA },
      },
      required: ["runId", "tasks"],
    },
  },
  {
    name: "byv_update_task",
    description: "Enforce legal task state transitions. DONE requires a handoff and a latest executed PASS verification for every acceptance criterion.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        taskId: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["TODO", "READY", "IN_PROGRESS", "BLOCKED", "REVIEW", "DONE"] },
        reason: { type: "string", maxLength: 1500 },
      },
      required: ["runId", "taskId", "status"],
    },
  },
  {
    name: "byv_record_handoff",
    description: "Persist a concise task handoff, changed file paths, unresolved risks, next action, and evidence references. Handoffs do not prove a runtime spawn by themselves.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        taskId: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1, maxLength: 4000 },
        changedFiles: stringArraySchema("Repository-relative changed file paths."),
        unresolvedRisks: stringArraySchema("Known unresolved risks."),
        nextAction: { type: "string", minLength: 1, maxLength: 1000 },
        evidenceRefs: stringArraySchema("Short evidence references, not transcripts or secrets."),
      },
      required: ["runId", "taskId", "summary", "nextAction"],
    },
  },
  {
    name: "byv_record_verification",
    description: "Record a verification observation for an acceptance criterion. A PASS requires executed=true. Provide a short redacted summary rather than raw logs or secrets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        taskId: { type: "string", minLength: 1 },
        criterionId: { type: "string", minLength: 1 },
        command: { type: "string", minLength: 1, maxLength: 1000 },
        outcome: { type: "string", enum: ["PASS", "FAIL", "BLOCKED", "NOT_TESTED"] },
        executed: { type: "boolean" },
        summary: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["runId", "taskId", "criterionId", "command", "outcome", "executed", "summary"],
    },
  },
  {
    name: "byv_finish_run",
    description: "Finish a run with DONE, BLOCKED, or FAILED disposition. DONE is rejected if any planned task remains unfinished.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        outcome: { type: "string", enum: ["DONE", "BLOCKED", "FAILED"] },
        summary: { type: "string", minLength: 1, maxLength: 4000 },
      },
      required: ["runId", "outcome", "summary"],
    },
  },
  {
    name: "byv_resume_run",
    description: "Explicitly resume a run marked interrupted by a control-plane restart. In-flight tasks remain BLOCKED until an operator/orchestrator re-evaluates them.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        runId: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1, maxLength: 1500 },
      },
      required: ["runId", "reason"],
    },
  },
  {
    name: "byv_get_run_summary",
    description: "Read a persisted run summary with task states, latest acceptance outcomes, handoffs, verification summaries, and audit events.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { runId: { type: "string", minLength: 1 } },
      required: ["runId"],
    },
  },
];

export async function createByvControlPlane({
  pluginRoot = SCRIPT_ROOT,
  projectRoot = process.env.BYV_PROJECT_ROOT || process.cwd(),
  env = process.env,
} = {}) {
  const resolvedPluginRoot = resolve(pluginRoot);
  const [loaded, schemaText] = await Promise.all([
    loadValidatedRegistry({ root: resolvedPluginRoot }),
    readFile(resolve(resolvedPluginRoot, "agents/registry.schema.json"), "utf8"),
  ]);
  const schema = JSON.parse(schemaText);
  const registryManager = await createRegistryManager({
    initialRegistry: loaded.registry,
    schema,
    root: resolvedPluginRoot,
  });
  const ledger = await createRunLedger({ projectRoot: resolve(projectRoot) });

  async function callTool(name, untrustedArgs = {}) {
    const args = requireObject(untrustedArgs);
    switch (name) {
      case "byv_runtime_status": {
        exactArgs(args, []);
        const status = inspectApiOnlyEnvironment(env);
        return {
          ...status,
          credentialSourceCategory: status.credentials.authTokenPresent
            ? "auth-token" : status.credentials.apiKeyPresent ? "api-key" : "none",
          credentials: {
            apiKeyPresent: status.credentials.apiKeyPresent,
            authTokenPresent: status.credentials.authTokenPresent,
            valuesRedacted: true,
          },
          secretValuesReturned: false,
        };
      }
      case "byv_registry_status": {
        exactArgs(args, []);
        return snapshotSummary(registryManager.getSnapshot(), registryManager.getAuditLog());
      }
      case "byv_reload_registry": {
        exactArgs(args, []);
        const registryText = await readFile(resolve(resolvedPluginRoot, "agents/registry.json"), "utf8");
        const candidate = JSON.parse(registryText);
        const snapshot = await registryManager.reload(candidate, { source: "bundled-registry-file" });
        return snapshotSummary(snapshot, registryManager.getAuditLog());
      }
      case "byv_prepare_agent": {
        exactArgs(args, ["agentId", "parentAgentId", "task", "expectedOutput", "acceptanceCriteria", "relevantContext", "runId"],
          ["agentId", "task", "expectedOutput", "acceptanceCriteria"]);
        const run = args.runId ? await ledger.getRun(args.runId) : null;
        const registry = run ? run.registry.snapshot : registryManager.getSnapshot().registry;
        const criteria = args.acceptanceCriteria.map((item) => redactText(item));
        const context = (args.relevantContext || []).map((item) => redactText(item));
        return await createBootstrapPacket({
          registry,
          root: resolvedPluginRoot,
          agentId: redactText(args.agentId),
          parentAgentId: args.parentAgentId ? redactText(args.parentAgentId) : undefined,
          task: redactText(args.task),
          expectedOutput: redactText(args.expectedOutput),
          acceptanceCriteria: criteria,
          relevantContext: context,
        });
      }
      case "byv_begin_run": {
        exactArgs(args, ["executionMode"], ["executionMode"]);
        const preflight = inspectApiOnlyEnvironment(env);
        if (preflight.status !== "configuration_preflight_passed") {
          throw new Error("Cannot begin run: API-only preflight is blocked (" +
            preflight.issues.map((issue) => issue.code).join(", ") + ")");
        }
        const snapshot = registryManager.getSnapshot();
        return await ledger.beginRun({
          executionMode: args.executionMode,
          provider: {
            profileId: preflight.providerProfileId,
            endpointHost: preflight.endpoint.host,
            protocol: preflight.protocol,
            modelId: preflight.model.id,
            credentialSource: preflight.credentials.authTokenPresent ? "auth-token" :
              preflight.credentials.apiKeyPresent ? "api-key" : "unknown",
          },
          registry: {
            generation: snapshot.generation,
            registryId: snapshot.registryId,
            schemaVersion: snapshot.schemaVersion,
            digest: snapshot.registryDigest || digestJson(snapshot.registry),
            snapshot: snapshot.registry,
          },
        });
      }
      case "byv_record_plan": {
        exactArgs(args, ["runId", "tasks"], ["runId", "tasks"]);
        return await ledger.recordPlan({ runId: args.runId, tasks: args.tasks });
      }
      case "byv_update_task": {
        exactArgs(args, ["runId", "taskId", "status", "reason"], ["runId", "taskId", "status"]);
        return await ledger.updateTask(args);
      }
      case "byv_record_handoff": {
        exactArgs(args, ["runId", "taskId", "summary", "changedFiles", "unresolvedRisks", "nextAction", "evidenceRefs"],
          ["runId", "taskId", "summary", "nextAction"]);
        return await ledger.recordHandoff(args);
      }
      case "byv_record_verification": {
        exactArgs(args, ["runId", "taskId", "criterionId", "command", "outcome", "executed", "summary"],
          ["runId", "taskId", "criterionId", "command", "outcome", "executed", "summary"]);
        return await ledger.recordVerification(args);
      }
      case "byv_finish_run": {
        exactArgs(args, ["runId", "outcome", "summary"], ["runId", "outcome", "summary"]);
        return await ledger.finishRun(args);
      }
      case "byv_resume_run": {
        exactArgs(args, ["runId", "reason"], ["runId", "reason"]);
        return await ledger.resumeRun(args);
      }
      case "byv_get_run_summary": {
        exactArgs(args, ["runId"], ["runId"]);
        return await ledger.getRunSummary(args);
      }
      default:
        throw Object.assign(new Error("Unknown tool: " + name), { code: -32601 });
    }
  }

  return {
    tools: TOOLS.map((item) => ({ ...item })),
    callTool,
    registryManager,
    ledger,
    pluginRoot: resolvedPluginRoot,
    projectRoot: resolve(projectRoot),
  };
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message: redactText(message) } };
}

export async function handleMcpRequest(request, controlPlane) {
  if (!isObject(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return rpcError(request && Object.hasOwn(request, "id") ? request.id : null, -32600, "Invalid JSON-RPC request");
  }
  const hasId = Object.hasOwn(request, "id");
  const id = hasId ? request.id : null;
  const params = isObject(request.params) ? request.params : {};

  if (request.method === "notifications/initialized" ||
      request.method === "notifications/cancelled" ||
      request.method === "notifications/progress") {
    return null;
  }
  if (request.method === "initialize") {
    const requestedVersion = typeof params.protocolVersion === "string"
      ? params.protocolVersion : "2025-03-26";
    return response(id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "BYV control-plane tools validate registry, prepare agent context, and persist local run/task evidence. They do not spawn agents. Never pass API secrets to tools.",
    });
  }
  if (request.method === "ping") return response(id, {});
  if (request.method === "tools/list") {
    return response(id, { tools: controlPlane.tools });
  }
  if (request.method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string") return rpcError(id, -32602, "tools/call requires a tool name");
    try {
      const result = await controlPlane.callTool(name, params.arguments || {});
      return response(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (error) {
      if (error.code === -32601) return rpcError(id, -32601, error.message);
      return response(id, {
        content: [{ type: "text", text: redactText(error && error.message ? error.message : "Tool call failed") }],
        isError: true,
      });
    }
  }
  if (!hasId) return null;
  return rpcError(id, -32601, "Method not found: " + request.method);
}

async function main() {
  const pluginRoot = process.env.BYV_PLUGIN_ROOT || SCRIPT_ROOT;
  const projectRoot = process.env.BYV_PROJECT_ROOT || process.cwd();
  let controlPlane;
  try {
    controlPlane = await createByvControlPlane({ pluginRoot, projectRoot, env: process.env });
  } catch (error) {
    console.error("BYV MCP control plane failed to start: " +
      redactText(error && error.message ? error.message : "Unknown initialization error"));
    process.exitCode = 1;
    return;
  }

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on("line", (line) => {
    queue = queue.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify(rpcError(null, -32700, "Parse error")) + "\n");
        return;
      }
      try {
        const result = await handleMcpRequest(request, controlPlane);
        if (result !== null) process.stdout.write(JSON.stringify(result) + "\n");
      } catch (error) {
        if (request && Object.hasOwn(request, "id")) {
          process.stdout.write(JSON.stringify(rpcError(request.id, -32603, "Internal server error")) + "\n");
        }
        console.error("MCP request failed: " + redactText(error && error.message ? error.message : "Unknown error"));
      }
    }).catch((error) => {
      console.error("MCP input queue failed: " + redactText(error && error.message ? error.message : "Unknown error"));
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error("BYV MCP server fatal error: " + redactText(error && error.message ? error.message : "Unknown error"));
    process.exitCode = 1;
  });
}
