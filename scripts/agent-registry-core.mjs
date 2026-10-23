import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(value, expected, label) {
  check(isObject(value), `${label} must be an object`);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter((key) => !expectedSet.has(key));
  check(missing.length === 0, `${label} is missing required field(s): ${missing.join(", ")}`);
  check(unexpected.length === 0, `${label} contains unsupported field(s): ${unexpected.join(", ")}`);
}

function requireNonEmptyString(value, label) {
  check(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/**
 * Validate registry data and all referenced profile paths.
 * Exported separately so tests can exercise invalid candidate data without editing files.
 */
export async function validateRegistryData(registry, schema, root = REPOSITORY_ROOT) {
  requireExactKeys(registry, ["$schema", "schemaVersion", "registryId", "description", "agents"], "registry");
  check(isObject(schema) && isObject(schema.properties) && isObject(schema.properties.schemaVersion),
    "Registry schema is missing properties.schemaVersion");
  requireNonEmptyString(registry.$schema, "registry.$schema");
  check(registry.$schema === schema.$schema, "Registry $schema does not match the checked-in schema");
  check(registry.schemaVersion === schema.properties.schemaVersion.const, "Unsupported schemaVersion");
  check(typeof registry.registryId === "string" && /^[a-z][a-z0-9-]*$/.test(registry.registryId),
    "registryId must be a kebab-case identifier");
  requireNonEmptyString(registry.description, "registry.description");
  check(Array.isArray(registry.agents) && registry.agents.length > 0, "agents must be a non-empty array");

  const agentKeys = [
    "id", "name", "role", "profile", "type", "description",
    "capabilities", "enabled", "delegation", "permissions",
  ];
  const ids = new Set();

  for (const [index, agent] of registry.agents.entries()) {
    const label = `agents[${index}]`;
    requireExactKeys(agent, agentKeys, label);
    check(typeof agent.id === "string" && /^[a-z][a-z0-9-]*$/.test(agent.id),
      `${label}.id must be a kebab-case identifier`);
    check(!ids.has(agent.id), `Duplicate agent id: ${agent.id}`);
    ids.add(agent.id);

    for (const key of ["name", "role", "description"]) {
      requireNonEmptyString(agent[key], `${label}.${key}`);
    }
    check(["orchestrator", "worker"].includes(agent.type), `${label}.type is invalid`);
    check(typeof agent.enabled === "boolean", `${label}.enabled must be boolean`);

    check(Array.isArray(agent.capabilities) && agent.capabilities.length > 0,
      `${label}.capabilities must be a non-empty array`);
    check(agent.capabilities.every((item) => typeof item === "string" && item.trim()),
      `${label}.capabilities must contain non-empty strings`);
    check(new Set(agent.capabilities).size === agent.capabilities.length,
      `${label}.capabilities must be unique`);

    if (agent.profile !== null) {
      requireNonEmptyString(agent.profile, `${label}.profile`);
      const profilePath = resolve(root, agent.profile);
      check(!isAbsolute(agent.profile) && isContainedPath(resolve(root), profilePath),
        `${label}.profile escapes repository root`);
      try {
        await access(profilePath);
      } catch {
        fail(`Missing profile for ${agent.id}: ${agent.profile}`);
      }
    }

    requireExactKeys(agent.delegation, ["canDelegate", "allowedTargets"], `${label}.delegation`);
    check(typeof agent.delegation.canDelegate === "boolean",
      `${label}.delegation.canDelegate must be boolean`);
    check(Array.isArray(agent.delegation.allowedTargets),
      `${label}.delegation.allowedTargets must be an array`);
    check(agent.delegation.allowedTargets.every((item) => typeof item === "string" && item.trim()),
      `${label}.delegation.allowedTargets must contain non-empty strings`);
    check(new Set(agent.delegation.allowedTargets).size === agent.delegation.allowedTargets.length,
      `${label}.delegation.allowedTargets must be unique`);
    if (!agent.delegation.canDelegate) {
      check(agent.delegation.allowedTargets.length === 0,
        `Agent "${agent.id}" cannot delegate but has allowedTargets`);
    }

    requireExactKeys(agent.permissions, ["sourceAccess", "shell", "network"], `${label}.permissions`);
    check(["read-only", "read-write"].includes(agent.permissions.sourceAccess),
      `${label}.permissions.sourceAccess is invalid`);
    check(["deny", "policy-controlled"].includes(agent.permissions.shell),
      `${label}.permissions.shell is invalid`);
    check(["deny", "policy-controlled"].includes(agent.permissions.network),
      `${label}.permissions.network is invalid`);
  }

  for (const agent of registry.agents) {
    for (const target of agent.delegation.allowedTargets) {
      check(ids.has(target), `Unknown delegation target "${target}" in agent "${agent.id}"`);
      check(target !== agent.id, `Agent "${agent.id}" cannot delegate to itself`);
    }
    if (agent.enabled) {
      for (const target of agent.delegation.allowedTargets) {
        const targetAgent = registry.agents.find((candidate) => candidate.id === target);
        check(targetAgent.enabled, `Enabled agent "${agent.id}" targets disabled agent "${target}"`);
      }
    }
  }

  return registry;
}

export async function loadValidatedRegistry({ root = REPOSITORY_ROOT } = {}) {
  const registryPath = resolve(root, "agents/registry.json");
  const schemaPath = resolve(root, "agents/registry.schema.json");
  let registry;
  let schema;

  try {
    registry = JSON.parse(await readFile(registryPath, "utf8"));
  } catch (error) {
    fail(`Cannot read or parse agents/registry.json: ${error.message}`);
  }
  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    fail(`Cannot read or parse agents/registry.schema.json: ${error.message}`);
  }

  await validateRegistryData(registry, schema, root);
  return { registry, schema };
}
