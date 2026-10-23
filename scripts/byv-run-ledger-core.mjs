import {
  mkdir, readdir, readFile, open, rename, unlink, lstat, realpath, stat,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const LEDGER_SCHEMA_VERSION = "1.0.0";
export const TASK_STATUSES = Object.freeze([
  "TODO", "READY", "IN_PROGRESS", "BLOCKED", "REVIEW", "DONE",
]);
const RUN_STATUSES = new Set(["in_progress", "interrupted", "done", "blocked", "failed"]);
const TERMINAL_RUN_STATUSES = new Set(["interrupted", "done", "blocked", "failed"]);
const OUTCOMES = new Set(["PASS", "FAIL", "BLOCKED", "NOT_TESTED"]);
const DEFAULT_MAX_RUNS = 100;
const DEFAULT_MAX_EVENTS = 2000;
const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function containedPath(root, candidate, allowRoot = false) {
  const rel = relative(root, candidate);
  return (allowRoot && rel === "") || (
    rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)
  );
}

function nonEmpty(value, label, max = 2000) {
  check(typeof value === "string" && value.trim().length > 0, label + " must be a non-empty string");
  const normalized = value.trim();
  check(normalized.length <= max, label + " exceeds the " + max + " character limit");
  return redactText(normalized);
}

function optionalText(value, label, max = 2000) {
  if (value === undefined || value === null) return "";
  check(typeof value === "string", label + " must be a string");
  check(value.length <= max, label + " exceeds the " + max + " character limit");
  return redactText(value.trim());
}

function timestamp(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  check(Number.isFinite(date.getTime()), "Ledger clock must return a valid date/time");
  return date.toISOString();
}

function validateRunId(runId) {
  check(
    typeof runId === "string" && /^run-[a-z0-9-]{8,80}$/.test(runId),
    "runId must be a valid BYV run identifier",
  );
  return runId;
}

function runFileName(runId) {
  return validateRunId(runId) + ".json";
}

export function redactText(value) {
  return String(value)
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|API_KEY|ACCESS_TOKEN|SECRET|TOKEN)\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1[REDACTED]")
    .slice(0, 4000);
}

function safeRelativePath(value, label) {
  const text = nonEmpty(value, label, 500).replace(/\\/g, "/");
  check(!text.startsWith("/") && !/^[A-Za-z]:/.test(text), label + " must be repository-relative");
  const segments = text.split("/");
  check(!segments.some((part) => part === ".." || part === "." || part === ""), label + " contains an unsafe path segment");
  return text;
}

function ensureArrayStrings(value, label, { min = 0, max = 100 } = {}) {
  check(Array.isArray(value), label + " must be an array");
  check(value.length >= min && value.length <= max, label + " length must be between " + min + " and " + max);
  return value.map((item, index) => nonEmpty(item, label + "[" + index + "]", 1000));
}

function addEvent(record, event, details, clock, maxEvents) {
  record.eventSequence += 1;
  record.events.push({
    sequence: record.eventSequence,
    event,
    at: timestamp(clock),
    details: details || {},
  });
  if (record.events.length > maxEvents) {
    record.events.splice(0, record.events.length - maxEvents);
  }
}

function assertRunRecord(record, expectedId, maxRecordBytes) {
  check(isObject(record), "Ledger run record must be an object");
  check(record.ledgerSchemaVersion === LEDGER_SCHEMA_VERSION, "Unsupported ledger schema version");
  check(validateRunId(record.runId) === expectedId, "Ledger run ID does not match its filename");
  check(RUN_STATUSES.has(record.status), "Ledger run status is invalid");
  check(Array.isArray(record.tasks) && Array.isArray(record.events), "Ledger run arrays are invalid");
  check(Number.isSafeInteger(record.eventSequence) && record.eventSequence >= 0, "Ledger event sequence is invalid");
  check(Buffer.byteLength(JSON.stringify(record), "utf8") <= maxRecordBytes, "Ledger record exceeds the size limit");
  return record;
}

function checkPlanDependencies(tasks) {
  const ids = new Set(tasks.map((task) => task.taskId));
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      check(ids.has(dependency), "Task " + task.taskId + " references unknown dependency " + dependency);
      check(dependency !== task.taskId, "Task " + task.taskId + " cannot depend on itself");
    }
  }
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visiting.has(taskId)) fail("Task plan contains a dependency cycle at " + taskId);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dep of byId.get(taskId).dependencies) visit(dep);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const task of tasks) visit(task.taskId);
}

function normalizeTaskPlan(tasks, registrySnapshot) {
  check(Array.isArray(tasks) && tasks.length > 0 && tasks.length <= 100, "tasks must contain 1 to 100 tasks");
  const agentMap = new Map((registrySnapshot.agents || []).map((agent) => [agent.id, agent]));
  const normalized = tasks.map((task, index) => {
    const label = "tasks[" + index + "]";
    check(isObject(task), label + " must be an object");
    const allowed = ["taskId", "ownerAgentId", "dependencies", "scope", "files", "acceptanceCriteria"];
    const unexpected = Object.keys(task).filter((key) => !allowed.includes(key));
    check(unexpected.length === 0, label + " contains unsupported fields: " + unexpected.join(", "));
    const taskId = nonEmpty(task.taskId, label + ".taskId", 80);
    check(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(taskId), label + ".taskId has an invalid format");
    const ownerAgentId = nonEmpty(task.ownerAgentId, label + ".ownerAgentId", 80);
    const owner = agentMap.get(ownerAgentId);
    check(owner, label + " owner is not present in the pinned registry snapshot");
    check(owner.enabled === true, label + " owner is disabled in the pinned registry snapshot");
    const dependencies = ensureArrayStrings(task.dependencies, label + ".dependencies", { max: 100 });
    check(new Set(dependencies).size === dependencies.length, label + ".dependencies must be unique");
    const scope = nonEmpty(task.scope, label + ".scope", 2000);
    check(Array.isArray(task.files), label + ".files must be an array");
    check(task.files.length <= 100, label + ".files cannot have more than 100 entries");
    const files = task.files.map((path, fileIndex) =>
      safeRelativePath(path, label + ".files[" + fileIndex + "]"));
    check(new Set(files).size === files.length, label + ".files must be unique");
    check(Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0,
      label + ".acceptanceCriteria must be a non-empty array");
    check(task.acceptanceCriteria.length <= 100, label + ".acceptanceCriteria cannot exceed 100 entries");
    const seenCriteria = new Set();
    const acceptanceCriteria = task.acceptanceCriteria.map((criterion, criterionIndex) => {
      const criterionLabel = label + ".acceptanceCriteria[" + criterionIndex + "]";
      check(isObject(criterion), criterionLabel + " must be an object");
      const invalid = Object.keys(criterion).filter((key) => !["id", "description"].includes(key));
      check(invalid.length === 0, criterionLabel + " contains unsupported fields: " + invalid.join(", "));
      const id = nonEmpty(criterion.id, criterionLabel + ".id", 80);
      check(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id), criterionLabel + ".id has an invalid format");
      check(!seenCriteria.has(id), criterionLabel + ".id must be unique within the task");
      seenCriteria.add(id);
      return {
        id,
        description: nonEmpty(criterion.description, criterionLabel + ".description", 1500),
      };
    });
    return {
      taskId, ownerAgentId, dependencies, scope, files, acceptanceCriteria,
      status: "TODO", blockReason: null, handoff: null, verifications: [],
      createdAt: null, updatedAt: null,
    };
  });
  const taskIds = new Set(normalized.map((task) => task.taskId));
  check(taskIds.size === normalized.length, "Task IDs must be unique");
  checkPlanDependencies(normalized);
  return normalized;
}

function latestVerification(task, criterionId) {
  for (let index = task.verifications.length - 1; index >= 0; index -= 1) {
    if (task.verifications[index].criterionId === criterionId) return task.verifications[index];
  }
  return null;
}

function summarizeRecord(record) {
  return {
    ledgerSchemaVersion: record.ledgerSchemaVersion,
    runId: record.runId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    executionMode: record.executionMode,
    provider: clone(record.provider),
    registry: {
      generation: record.registry.generation,
      registryId: record.registry.registryId,
      schemaVersion: record.registry.schemaVersion,
      digest: record.registry.digest,
    },
    planRecorded: record.planRecorded,
    tasks: record.tasks.map((task) => ({
      taskId: task.taskId,
      ownerAgentId: task.ownerAgentId,
      dependencies: [...task.dependencies],
      scope: task.scope,
      files: [...task.files],
      status: task.status,
      blockReason: task.blockReason,
      acceptanceCriteria: task.acceptanceCriteria.map((criterion) => {
        const latest = latestVerification(task, criterion.id);
        return {
          id: criterion.id,
          description: criterion.description,
          latestOutcome: latest ? latest.outcome : "NOT_TESTED",
        };
      }),
      handoff: task.handoff ? clone(task.handoff) : null,
      verifications: clone(task.verifications),
    })),
    events: clone(record.events),
    finalSummary: record.finalSummary,
    finalDisposition: record.finalDisposition,
    recoveryCount: record.recoveryCount,
  };
}

/**
 * Project-scoped JSON run ledger. Mutations are serialized in-process and across
 * server processes with an exclusive lock file; run snapshots use atomic rename.
 */
export async function createRunLedger({
  projectRoot = process.cwd(),
  storageDir = null,
  clock = () => new Date(),
  maxRuns = DEFAULT_MAX_RUNS,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
  lockTimeoutMs = 5000,
  recoverAllActiveRuns = false,
} = {}) {
  check(typeof clock === "function", "clock must be a function");
  check(Number.isSafeInteger(maxRuns) && maxRuns >= 1, "maxRuns must be a positive safe integer");
  check(Number.isSafeInteger(maxEvents) && maxEvents >= 10, "maxEvents must be at least 10");
  check(Number.isSafeInteger(maxRecordBytes) && maxRecordBytes >= 4096, "maxRecordBytes must be at least 4096");
  check(Number.isSafeInteger(lockTimeoutMs) && lockTimeoutMs >= 100, "lockTimeoutMs must be at least 100ms");

  const projectRootReal = await realpath(resolve(projectRoot));
  const directory = resolve(storageDir || resolve(projectRootReal, ".byv-agent", "runs"));
  check(containedPath(projectRootReal, directory), "Ledger storage directory must remain inside the configured project root");

  async function ensureSafeDirectory() {
    check(containedPath(projectRootReal, directory), "Ledger storage directory escaped the configured project root");
    const relativeDir = relative(projectRootReal, directory);
    const segments = relativeDir.split(sep).filter(Boolean);
    let current = projectRootReal;
    for (const segment of segments) {
      current = resolve(current, segment);
      try {
        await mkdir(current);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const info = await lstat(current);
      check(info.isDirectory() && !info.isSymbolicLink(), "Ledger path contains a non-directory or symbolic link");
      const real = await realpath(current);
      check(containedPath(projectRootReal, real), "Ledger directory resolves outside the configured project root");
    }
  }

  async function withFileLock(operation) {
    await ensureSafeDirectory();
    const lockPath = resolve(directory, ".ledger.lock");
    const started = Date.now();
    let handle;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = null;
        }
        if (error.code !== "EEXIST") throw error;
        try {
          const info = await stat(lockPath);
          if (Date.now() - info.mtimeMs > 30000) {
            await unlink(lockPath).catch(() => {});
            continue;
          }
        } catch (statError) {
          if (statError.code === "ENOENT") continue;
          throw statError;
        }
        if (Date.now() - started >= lockTimeoutMs) {
          fail("Ledger is busy: timed out waiting for the exclusive write lock");
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }

  const instanceId = randomBytes(16).toString("hex");
  let mutationQueue = Promise.resolve();
  function mutate(operation) {
    const pending = mutationQueue.then(
      () => withFileLock(operation),
      () => withFileLock(operation),
    );
    mutationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function readRun(runId) {
    validateRunId(runId);
    await ensureSafeDirectory();
    const path = resolve(directory, runFileName(runId));
    check(containedPath(directory, path), "Ledger record path escaped the storage directory");
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") fail("Run not found: " + runId);
      throw error;
    }
    check(info.isFile() && !info.isSymbolicLink(), "Ledger record must be a regular file");
    check(info.size <= maxRecordBytes, "Ledger record exceeds the size limit");
    let record;
    try {
      record = JSON.parse(await readFile(path, "utf8"));
    } catch {
      fail("Ledger record is unreadable or invalid JSON: " + runId);
    }
    return assertRunRecord(record, runId, maxRecordBytes);
  }

  async function writeRun(record) {
    record.updatedAt = timestamp(clock);
    const body = JSON.stringify(record, null, 2) + "\n";
    check(Buffer.byteLength(body, "utf8") <= maxRecordBytes, "Ledger record exceeds the size limit");
    const target = resolve(directory, runFileName(record.runId));
    check(containedPath(directory, target), "Ledger target path escaped the storage directory");
    const temporary = resolve(directory, ".tmp-" + randomBytes(10).toString("hex") + ".json");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return clone(record);
  }

  async function listRecordsUnlocked() {
    const names = await readdir(directory);
    const files = names.filter((name) => /^run-[a-z0-9-]{8,80}\.json$/.test(name)).sort();
    const records = [];
    for (const name of files) {
      const path = resolve(directory, name);
      const info = await lstat(path);
      check(info.isFile() && !info.isSymbolicLink(), "Ledger record path must be a regular file");
      check(info.size <= maxRecordBytes, "Ledger record exceeds the size limit: " + name);
      let record;
      try {
        record = JSON.parse(await readFile(path, "utf8"));
      } catch {
        fail("Ledger record is unreadable or invalid JSON: " + name);
      }
      records.push(assertRunRecord(record, name.slice(0, -5), maxRecordBytes));
    }
    return records;
  }

  async function pruneRunsUnlocked() {
    const records = await listRecordsUnlocked();
    if (records.length < maxRuns) return;
    const terminal = records
      .filter((record) => TERMINAL_RUN_STATUSES.has(record.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let count = records.length;
    for (const record of terminal) {
      if (count < maxRuns) break;
      await unlink(resolve(directory, runFileName(record.runId)));
      count -= 1;
    }
    check(count < maxRuns, "Ledger retention limit reached; active runs are preserved. Finish or archive an active run before creating another.");
  }

  async function recoverInterruptedRuns() {
    return mutate(async () => {
      const records = await listRecordsUnlocked();
      let recoveredCount = 0;
      for (const record of records) {
        if (record.status !== "in_progress") continue;
        const ownerPid = record.ownerPid;
        let ownerAlive = false;
        if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
          try {
            process.kill(ownerPid, 0);
            ownerAlive = true;
          } catch (error) {
            ownerAlive = error.code === "EPERM";
          }
        }
        if (ownerAlive && !recoverAllActiveRuns) continue;
        record.status = "interrupted";
        record.recoveryCount = (record.recoveryCount || 0) + 1;
        const blockedTaskIds = [];
        for (const task of record.tasks) {
          if (task.status === "IN_PROGRESS") {
            task.status = "BLOCKED";
            task.blockReason = "Recovered after control-plane restart; previous execution outcome is unknown.";
            task.updatedAt = timestamp(clock);
            blockedTaskIds.push(task.taskId);
          }
        }
        addEvent(record, "run.interrupted", {
          reason: "control-plane-restart",
          inFlightTasksMarkedBlocked: blockedTaskIds,
        }, clock, maxEvents);
        await writeRun(record);
        recoveredCount += 1;
      }
      return recoveredCount;
    });
  }

  await ensureSafeDirectory();
  await recoverInterruptedRuns();

  function ensureActive(record) {
    check(record.status === "in_progress", "Run is not active; status is " + record.status);
  }

  async function beginRun({ executionMode = "unselected", provider, registry }) {
    check(["unselected", "native-agent-teams", "custom-subagents", "sequential"].includes(executionMode),
      "executionMode is invalid");
    check(isObject(provider), "provider context is required");
    check(isObject(registry) && isObject(registry.snapshot), "validated registry snapshot is required");
    check(Number.isSafeInteger(registry.generation) && registry.generation >= 1, "registry generation is invalid");
    check(typeof registry.registryId === "string" && registry.registryId.trim(), "registryId is invalid");
    check(typeof registry.schemaVersion === "string" && registry.schemaVersion.trim(), "registry schemaVersion is invalid");
    check(typeof registry.digest === "string" && /^[a-f0-9]{64}$/.test(registry.digest), "registry digest is invalid");
    check(["anthropic-messages", "translated-anthropic-messages"].includes(provider.protocol),
      "provider protocol is invalid");
    const now = timestamp(clock);
    const runId = "run-" + Date.now().toString(36) + "-" + randomBytes(6).toString("hex");
    return mutate(async () => {
      await pruneRunsUnlocked();
      const record = {
        ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
        runId,
        createdAt: now,
        updatedAt: now,
        status: "in_progress",
        ownerPid: process.pid,
        ownerInstanceId: instanceId,
        executionMode,
        provider: {
          profileId: nonEmpty(provider.profileId, "provider.profileId", 64),
          endpointHost: nonEmpty(provider.endpointHost, "provider.endpointHost", 255),
          protocol: provider.protocol,
          modelId: nonEmpty(provider.modelId, "provider.modelId", 200),
          credentialSource: ["api-key", "auth-token"].includes(provider.credentialSource)
            ? provider.credentialSource : "unknown",
          activeCredentialSourceVerified: false,
        },
        registry: {
          generation: registry.generation,
          registryId: nonEmpty(registry.registryId, "registry.registryId", 100),
          schemaVersion: nonEmpty(registry.schemaVersion, "registry.schemaVersion", 40),
          digest: registry.digest,
          snapshot: clone(registry.snapshot),
        },
        planRecorded: false,
        tasks: [],
        events: [],
        eventSequence: 0,
        finalSummary: null,
        finalDisposition: null,
        recoveryCount: 0,
      };
      addEvent(record, "run.created", {
        executionMode,
        providerProfileId: record.provider.profileId,
        modelId: record.provider.modelId,
        registryGeneration: record.registry.generation,
        registryDigest: record.registry.digest,
      }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function getRun(runId) {
    return clone(await readRun(runId));
  }

  async function recordPlan({ runId, tasks }) {
    return mutate(async () => {
      const record = await readRun(runId);
      ensureActive(record);
      check(!record.planRecorded, "A run plan has already been recorded and cannot be replaced");
      const normalized = normalizeTaskPlan(tasks, record.registry.snapshot);
      const now = timestamp(clock);
      for (const task of normalized) {
        task.createdAt = now;
        task.updatedAt = now;
      }
      record.tasks = normalized;
      record.planRecorded = true;
      addEvent(record, "run.plan-recorded", {
        taskCount: normalized.length,
        taskIds: normalized.map((task) => task.taskId),
      }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function updateTask({ runId, taskId, status, reason = "" }) {
    check(TASK_STATUSES.includes(status), "Task status is invalid");
    const normalizedReason = optionalText(reason, "reason", 1500);
    return mutate(async () => {
      const record = await readRun(runId);
      ensureActive(record);
      const task = record.tasks.find((item) => item.taskId === taskId);
      check(task, "Task not found in run: " + taskId);
      const from = task.status;
      const allowed = {
        TODO: ["READY", "BLOCKED"],
        READY: ["IN_PROGRESS", "BLOCKED"],
        IN_PROGRESS: ["REVIEW", "BLOCKED"],
        BLOCKED: ["READY"],
        REVIEW: ["IN_PROGRESS", "DONE", "BLOCKED"],
        DONE: [],
      };
      check(allowed[from].includes(status), "Invalid task transition: " + from + " -> " + status);
      if (status === "BLOCKED") check(normalizedReason.length > 0, "A reason is required when blocking a task");
      if (status === "READY") {
        for (const depId of task.dependencies) {
          const dep = record.tasks.find((item) => item.taskId === depId);
          check(dep && dep.status === "DONE", "Task " + task.taskId + " cannot become READY before dependency " + depId + " is DONE");
        }
      }
      if (status === "REVIEW") {
        check(task.handoff, "Task cannot enter REVIEW before a handoff is recorded");
        check(task.verifications.length > 0, "Task cannot enter REVIEW before verification evidence is recorded");
      }
      if (status === "DONE") {
        check(task.handoff, "Task cannot become DONE before a handoff is recorded");
        const pending = task.acceptanceCriteria.filter((criterion) => {
          const latest = latestVerification(task, criterion.id);
          return !latest || latest.outcome !== "PASS" || latest.executed !== true;
        });
        check(pending.length === 0, "Task cannot become DONE; acceptance criteria are not all verified PASS: " +
          pending.map((criterion) => criterion.id).join(", "));
      }
      task.status = status;
      task.blockReason = status === "BLOCKED" ? normalizedReason : null;
      task.updatedAt = timestamp(clock);
      addEvent(record, "task.status-changed", {
        taskId: task.taskId,
        from,
        to: status,
        reason: status === "BLOCKED" ? normalizedReason : "",
      }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function recordHandoff({ runId, taskId, summary, changedFiles = [], unresolvedRisks = [], nextAction, evidenceRefs = [] }) {
    const handoff = {
      summary: nonEmpty(summary, "summary", 4000),
      changedFiles: ensureArrayStrings(changedFiles, "changedFiles", { max: 100 }).map((path) =>
        safeRelativePath(path, "changedFiles entry")),
      unresolvedRisks: ensureArrayStrings(unresolvedRisks, "unresolvedRisks", { max: 100 }),
      nextAction: nonEmpty(nextAction, "nextAction", 1000),
      evidenceRefs: ensureArrayStrings(evidenceRefs, "evidenceRefs", { max: 100 }),
    };
    return mutate(async () => {
      const record = await readRun(runId);
      ensureActive(record);
      const task = record.tasks.find((item) => item.taskId === taskId);
      check(task, "Task not found in run: " + taskId);
      check(task.status === "IN_PROGRESS", "Handoff can only be recorded for an IN_PROGRESS task");
      task.handoff = handoff;
      task.updatedAt = timestamp(clock);
      addEvent(record, "task.handoff-recorded", {
        taskId,
        changedFileCount: handoff.changedFiles.length,
        unresolvedRiskCount: handoff.unresolvedRisks.length,
        evidenceRefCount: handoff.evidenceRefs.length,
      }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function recordVerification({ runId, taskId, criterionId, command, outcome, executed, summary }) {
    check(OUTCOMES.has(outcome), "Verification outcome must be PASS, FAIL, BLOCKED, or NOT_TESTED");
    check(typeof executed === "boolean", "executed must be a boolean");
    check(!(outcome === "PASS" && executed !== true), "A PASS outcome requires executed=true");
    const verification = {
      criterionId: nonEmpty(criterionId, "criterionId", 80),
      command: nonEmpty(command, "command", 1000),
      outcome,
      executed,
      summary: nonEmpty(summary, "summary", 2000),
    };
    return mutate(async () => {
      const record = await readRun(runId);
      ensureActive(record);
      const task = record.tasks.find((item) => item.taskId === taskId);
      check(task, "Task not found in run: " + taskId);
      check(["IN_PROGRESS", "REVIEW"].includes(task.status),
        "Verification can only be recorded while a task is IN_PROGRESS or REVIEW");
      check(task.acceptanceCriteria.some((criterion) => criterion.id === verification.criterionId),
        "Verification criterionId does not belong to the task");
      verification.recordedAt = timestamp(clock);
      task.verifications.push(verification);
      check(task.verifications.length <= 500, "Task verification history limit reached");
      task.updatedAt = timestamp(clock);
      addEvent(record, "task.verification-recorded", {
        taskId,
        criterionId: verification.criterionId,
        outcome,
        executed,
      }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function finishRun({ runId, outcome, summary }) {
    check(["DONE", "BLOCKED", "FAILED"].includes(outcome), "Run outcome must be DONE, BLOCKED, or FAILED");
    const finalSummary = nonEmpty(summary, "summary", 4000);
    return mutate(async () => {
      const record = await readRun(runId);
      ensureActive(record);
      if (outcome === "DONE") {
        check(record.planRecorded && record.tasks.length > 0, "Cannot finish a run DONE without a recorded task plan");
        const unfinished = record.tasks.filter((task) => task.status !== "DONE");
        check(unfinished.length === 0, "Cannot finish a run DONE while tasks remain unfinished: " +
          unfinished.map((task) => task.taskId + "=" + task.status).join(", "));
      }
      record.status = outcome.toLowerCase();
      record.finalDisposition = outcome;
      record.finalSummary = finalSummary;
      addEvent(record, "run.finished", { outcome, summary: finalSummary }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function resumeRun({ runId, reason }) {
    const normalizedReason = nonEmpty(reason, "reason", 1500);
    return mutate(async () => {
      const record = await readRun(runId);
      check(record.status === "interrupted", "Only an interrupted run can be resumed");
      record.status = "in_progress";
      record.ownerPid = process.pid;
      record.ownerInstanceId = instanceId;
      record.finalDisposition = null;
      record.finalSummary = null;
      addEvent(record, "run.resumed", { reason: normalizedReason }, clock, maxEvents);
      await writeRun(record);
      return summarizeRecord(record);
    });
  }

  async function getRunSummary({ runId }) {
    const record = await readRun(runId);
    return summarizeRecord(record);
  }

  return {
    beginRun,
    getRun,
    getRunSummary,
    recordPlan,
    updateTask,
    recordHandoff,
    recordVerification,
    finishRun,
    resumeRun,
    recoverInterruptedRuns,
    listRuns: async () => (await listRecordsUnlocked()).map((record) => ({
      runId: record.runId, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt,
    })),
    storageDirectory: directory,
  };
}
