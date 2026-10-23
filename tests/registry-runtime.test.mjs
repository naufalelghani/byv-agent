import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { createRegistryManager } from "../scripts/agent-registry-runtime.mjs";

const root = REPOSITORY_ROOT;
const cliPath = resolve(root, "scripts/validate-registry-candidate.mjs");

async function getRegistryAndSchema() {
  return loadValidatedRegistry();
}

async function createManager(options = {}) {
  const { registry, schema } = await getRegistryAndSchema();
  return createRegistryManager({
    initialRegistry: registry,
    schema,
    root,
    clock: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 9, 23, 0, 0, tick++));
    })(),
    ...options,
  });
}

test("initializes an isolated, validated registry snapshot and audit record", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager();
  registry.description = "mutated by caller";
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.generation, 1);
  assert.equal(snapshot.registryId, "byv-agent-registry");
  assert.equal(snapshot.registry.agents.length, 5);
  assert.notEqual(snapshot.registry.description, "mutated by caller");
  assert.equal(manager.getAuditLog()[0].outcome, "activated");

  snapshot.registry.agents.pop();
  assert.equal(manager.getSnapshot().registry.agents.length, 5);
});

test("activates a valid candidate only after validation and increments generation", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager();
  const candidate = structuredClone(registry);
  candidate.description = "Updated in-memory registry";

  const result = await manager.reload(candidate, { source: "unit-test" });
  assert.equal(result.generation, 2);
  assert.equal(result.registry.description, "Updated in-memory registry");
  assert.equal(result.registryId, "byv-agent-registry");

  const audit = manager.getAuditLog();
  assert.equal(audit.at(-1).outcome, "activated");
  assert.equal(audit.at(-1).source, "unit-test");
  assert.equal(audit.at(-1).previousGeneration, 1);
  assert.equal(audit.at(-1).generation, 2);
});

test("rejects an invalid candidate and preserves the last valid active snapshot", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager();
  const before = manager.getSnapshot();
  const invalid = structuredClone(registry);
  invalid.schemaVersion = "99.0.0";

  await assert.rejects(
    manager.reload(invalid, { source: "bad-candidate" }),
    /Unsupported schemaVersion/,
  );
  const after = manager.getSnapshot();
  assert.equal(after.generation, before.generation);
  assert.equal(after.registryDigest, before.registryDigest);
  assert.deepEqual(after.registry, before.registry);
  assert.equal(manager.getAuditLog().at(-1).outcome, "rejected");
  assert.match(manager.getAuditLog().at(-1).error, /Unsupported schemaVersion/);
});

test("serializes concurrent reloads and continues after a rejected update", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager();
  const first = structuredClone(registry);
  first.description = "First candidate";
  const invalid = structuredClone(registry);
  invalid.registryId = "INVALID ID";
  const last = structuredClone(registry);
  last.description = "Last candidate";

  const operations = await Promise.allSettled([
    manager.reload(first, { source: "first" }),
    manager.reload(invalid, { source: "invalid" }),
    manager.reload(last, { source: "last" }),
  ]);

  assert.equal(operations[0].status, "fulfilled");
  assert.equal(operations[1].status, "rejected");
  assert.equal(operations[2].status, "fulfilled");
  const current = manager.getSnapshot();
  assert.equal(current.generation, 3);
  assert.equal(current.registry.description, "Last candidate");
  assert.deepEqual(
    manager.getAuditLog().slice(-3).map((entry) => entry.outcome),
    ["activated", "rejected", "activated"],
  );
});

test("treats an identical candidate as a no-op without incrementing generation", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager();
  const initial = manager.getSnapshot();
  const unchanged = await manager.reload(registry);

  assert.equal(unchanged.generation, initial.generation);
  assert.equal(unchanged.registryDigest, initial.registryDigest);
  assert.equal(manager.getAuditLog().at(-1).outcome, "unchanged");
});

test("bounds audit history to the configured number of entries", async () => {
  const { registry } = await getRegistryAndSchema();
  const manager = await createManager({ auditLimit: 2 });
  const a = structuredClone(registry);
  a.description = "Candidate A";
  const b = structuredClone(registry);
  b.description = "Candidate B";

  await manager.reload(a);
  await manager.reload(b);
  assert.equal(manager.getAuditLog().length, 2);
  assert.equal(manager.getAuditLog().at(-1).outcome, "activated");
});

test("candidate CLI validates and fingerprints a candidate without activating or editing registry.json", async () => {
  const { registry } = await getRegistryAndSchema();
  const originalText = await readFile(resolve(root, "agents/registry.json"), "utf8");
  const dir = await mkdtemp(join(tmpdir(), "byv-registry-candidate-"));
  const filePath = join(dir, "candidate.json");
  const candidate = structuredClone(registry);
  candidate.description = "Validated candidate, not activated";
  try {
    await writeFile(filePath, JSON.stringify(candidate, null, 2), "utf8");
    const result = spawnSync(process.execPath, [cliPath, filePath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.valid, true);
    assert.equal(output.candidateStatus, "valid_not_activated");
    assert.equal(output.registryId, registry.registryId);
    assert.equal(output.agentCount, registry.agents.length);
    assert.match(output.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(resolve(root, "agents/registry.json"), "utf8"), originalText);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("candidate CLI rejects policy-invalid registry data", async () => {
  const { registry } = await getRegistryAndSchema();
  const dir = await mkdtemp(join(tmpdir(), "byv-registry-invalid-"));
  const filePath = join(dir, "candidate.json");
  try {
    const invalid = structuredClone(registry);
    invalid.agents.find((agent) => agent.id === "byval").delegation.allowedTargets.push("missing-agent");
    await writeFile(filePath, JSON.stringify(invalid), "utf8");
    const result = spawnSync(process.execPath, [cliPath, filePath], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown delegation target "missing-agent"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
