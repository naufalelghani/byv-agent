#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(root, "agents/registry.json");
const schemaPath = resolve(root, "agents/registry.schema.json");

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function check(condition, message) { if (!condition) fail(message); }

async function main() {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  check(registry.schemaVersion === schema.properties.schemaVersion.const, "Unsupported schemaVersion");
  check(typeof registry.registryId === "string" && /^[a-z][a-z0-9-]*$/.test(registry.registryId), "registryId must be a kebab-case identifier");
  check(Array.isArray(registry.agents) && registry.agents.length > 0, "agents must be a non-empty array");

  const ids = new Set();
  for (const [index, agent] of registry.agents.entries()) {
    const label = `agents[${index}]`;
    check(isObject(agent), `${label} must be an object`);
    check(typeof agent.id === "string" && /^[a-z][a-z0-9-]*$/.test(agent.id), `${label}.id must be a kebab-case identifier`);
    check(!ids.has(agent.id), `Duplicate agent id: ${agent.id}`);
    ids.add(agent.id);
    for (const key of ["name", "role", "description"]) check(typeof agent[key] === "string" && agent[key].trim(), `${label}.${key} must be a non-empty string`);
    check(["orchestrator", "worker"].includes(agent.type), `${label}.type is invalid`);
    check(typeof agent.enabled === "boolean", `${label}.enabled must be boolean`);
    check(Array.isArray(agent.capabilities) && agent.capabilities.length > 0 && agent.capabilities.every(x => typeof x === "string" && x.trim()), `${label}.capabilities must contain non-empty strings`);
    check(new Set(agent.capabilities).size === agent.capabilities.length, `${label}.capabilities must be unique`);
    check(isObject(agent.delegation) && typeof agent.delegation.canDelegate === "boolean" && Array.isArray(agent.delegation.allowedTargets), `${label}.delegation is invalid`);
    check(new Set(agent.delegation.allowedTargets).size === agent.delegation.allowedTargets.length, `${label}.delegation.allowedTargets must be unique`);
    check(isObject(agent.permissions), `${label}.permissions must be an object`);
    check(["read-only", "read-write"].includes(agent.permissions.sourceAccess), `${label}.permissions.sourceAccess is invalid`);
    check(["deny", "policy-controlled"].includes(agent.permissions.shell), `${label}.permissions.shell is invalid`);
    check(["deny", "policy-controlled"].includes(agent.permissions.network), `${label}.permissions.network is invalid`);
    if (agent.profile !== null) {
      check(typeof agent.profile === "string" && agent.profile.length > 0, `${label}.profile must be a string or null`);
      const profilePath = resolve(root, agent.profile);
      check(!isAbsolute(agent.profile) && !relative(root, profilePath).startsWith(".."), `${label}.profile escapes repository root`);
      try { await access(profilePath); } catch { fail(`Missing profile for ${agent.id}: ${agent.profile}`); }
    }
  }

  for (const agent of registry.agents) {
    for (const target of agent.delegation.allowedTargets) {
      check(ids.has(target), `Unknown delegation target "${target}" in agent "${agent.id}"`);
      check(target !== agent.id, `Agent "${agent.id}" cannot delegate to itself`);
    }
    if (!agent.delegation.canDelegate) check(agent.delegation.allowedTargets.length === 0, `Agent "${agent.id}" cannot delegate but has allowedTargets`);
    if (agent.enabled) {
      for (const target of agent.delegation.allowedTargets) {
        const targetAgent = registry.agents.find(candidate => candidate.id === target);
        check(targetAgent.enabled, `Enabled agent "${agent.id}" targets disabled agent "${target}"`);
      }
    }
  }

  console.log(`Agent registry valid: ${registry.registryId} (schema ${registry.schemaVersion}), ${registry.agents.length} agents.`);
}

main().catch(error => {
  console.error(`Agent registry validation failed: ${error.message}`);
  process.exitCode = 1;
});
