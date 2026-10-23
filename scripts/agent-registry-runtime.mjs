import { createHash } from "node:crypto";
import { validateRegistryData, REPOSITORY_ROOT } from "./agent-registry-core.mjs";

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value, label) {
  try {
    return structuredClone(value);
  } catch {
    fail(`${label} must be cloneable data`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isObject(value)) {
    const entries = Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestRegistry(registry) {
  return createHash("sha256").update(stableStringify(registry)).digest("hex");
}

function timestampFrom(clock) {
  const raw = clock();
  const date = raw instanceof Date ? raw : new Date(raw);
  check(Number.isFinite(date.getTime()), "Registry manager clock must return a valid date/time");
  return date.toISOString();
}

function cloneAudit(audit) {
  return audit.map((entry) => ({ ...entry }));
}

/**
 * Create a process-local registry manager.
 *
 * Reloads are serialized, candidate state is validated before activation, and a failed
 * candidate never replaces the currently active registry. Nothing is written to disk.
 */
export async function createRegistryManager({
  initialRegistry,
  schema,
  root = REPOSITORY_ROOT,
  auditLimit = 100,
  clock = () => new Date(),
} = {}) {
  check(isObject(initialRegistry), "initialRegistry is required and must be an object");
  check(isObject(schema), "schema is required and must be an object");
  check(Number.isSafeInteger(auditLimit) && auditLimit >= 1,
    "auditLimit must be a positive safe integer");
  check(typeof clock === "function", "clock must be a function");

  const schemaSnapshot = cloneJsonValue(schema, "schema");
  const initialSnapshot = cloneJsonValue(initialRegistry, "initialRegistry");
  await validateRegistryData(initialSnapshot, schemaSnapshot, root);

  let activeRegistry = initialSnapshot;
  let generation = 1;
  let activatedAt = timestampFrom(clock);
  let activeDigest = digestRegistry(activeRegistry);
  const audit = [{
    event: "registry.initialize",
    outcome: "activated",
    at: activatedAt,
    source: "initial",
    previousGeneration: 0,
    generation,
    registryId: activeRegistry.registryId,
    registryDigest: activeDigest,
  }];
  let reloadQueue = Promise.resolve();

  function appendAudit(entry) {
    audit.push(entry);
    if (audit.length > auditLimit) audit.splice(0, audit.length - auditLimit);
  }

  function getSnapshot() {
    return {
      generation,
      activatedAt,
      registryId: activeRegistry.registryId,
      schemaVersion: activeRegistry.schemaVersion,
      registryDigest: activeDigest,
      registry: cloneJsonValue(activeRegistry, "active registry"),
    };
  }

  function getAuditLog() {
    return cloneAudit(audit);
  }

  async function applyReload(candidate, source) {
    const attemptedAt = timestampFrom(clock);
    const previousGeneration = generation;
    try {
      const validatedCandidate = cloneJsonValue(candidate, "candidate registry");
      await validateRegistryData(validatedCandidate, schemaSnapshot, root);
      const candidateDigest = digestRegistry(validatedCandidate);

      if (candidateDigest === activeDigest) {
        appendAudit({
          event: "registry.reload",
          outcome: "unchanged",
          at: attemptedAt,
          source,
          previousGeneration,
          generation,
          registryId: activeRegistry.registryId,
          registryDigest: activeDigest,
        });
        return getSnapshot();
      }

      // Commit point: activation only occurs after every validation has passed.
      activeRegistry = validatedCandidate;
      generation += 1;
      activatedAt = attemptedAt;
      activeDigest = candidateDigest;
      appendAudit({
        event: "registry.reload",
        outcome: "activated",
        at: attemptedAt,
        source,
        previousGeneration,
        generation,
        registryId: activeRegistry.registryId,
        registryDigest: activeDigest,
      });
      return getSnapshot();
    } catch (error) {
      appendAudit({
        event: "registry.reload",
        outcome: "rejected",
        at: attemptedAt,
        source,
        previousGeneration,
        generation,
        registryId: isObject(candidate) && typeof candidate.registryId === "string"
          ? candidate.registryId
          : null,
        error: String(error?.message || error).slice(0, 500),
      });
      throw error;
    }
  }

  function reload(candidateRegistry, { source = "runtime-reload" } = {}) {
    check(typeof source === "string" && source.trim().length > 0,
      "reload source must be a non-empty string");
    const normalizedSource = source.trim().slice(0, 120);
    const candidateSnapshot = cloneJsonValue(candidateRegistry, "candidate registry");

    const operation = reloadQueue.then(
      () => applyReload(candidateSnapshot, normalizedSource),
      () => applyReload(candidateSnapshot, normalizedSource),
    );
    // A rejected reload must not poison the queue for later candidates.
    reloadQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    getSnapshot,
    getAuditLog,
    reload,
  };
}

/** Stable SHA-256 digest helper for candidate-preflight tooling. */
export { digestRegistry };
