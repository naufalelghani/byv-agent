import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function exactKeys(value, expected, label) {
  check(isObject(value), `${label} must be an object`);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  check(missing.length === 0, `${label} is missing required field(s): ${missing.join(", ")}`);
  check(extra.length === 0, `${label} contains unsupported field(s): ${extra.join(", ")}`);
}

function parseAgentFrontmatter(content, agentId) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  check(match, `Agent profile for "${agentId}" is missing YAML frontmatter`);
  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*["']?([a-z][a-z0-9-]*)["']?\s*$/m);
  check(nameMatch, `Agent profile for "${agentId}" is missing a valid name field`);
  const toolsMatch = frontmatter.match(/^tools:\s*(.+?)\s*$/m);
  check(toolsMatch, `Agent profile for "${agentId}" must declare an explicit tools allowlist`);
  const tools = toolsMatch[1].split(",").map((tool) => tool.trim()).filter(Boolean);
  check(tools.length > 0, `Agent profile for "${agentId}" must declare at least one tool`);
  check(new Set(tools).size === tools.length, `Agent profile for "${agentId}" has duplicate tools`);
  return { name: nameMatch[1], tools };
}

/**
 * Validate registry entries against the actual bundled custom-agent profile metadata.
 * Registry permission fields are intent; this check rejects obvious allowlist conflicts,
 * but host permissions remain the real enforcement boundary.
 */
export async function validateAgentRuntimeMappings({ registry, root } = {}) {
  check(isObject(registry), "registry must be an object");
  check(typeof root === "string" && root.length > 0, "root must be a non-empty path");
  const repositoryRoot = resolve(root);
  check(Array.isArray(registry.agents) && registry.agents.length > 0,
    "registry.agents must be a non-empty array");

  const mappings = [];
  const definitionNames = new Set();

  for (const [index, agent] of registry.agents.entries()) {
    const label = `agents[${index}]`;
    exactKeys(agent.runtime, ["provider", "kind", ...(agent.runtime?.kind === "custom-agent" ? ["agentDefinition"] : [])], `${label}.runtime`);
    check(agent.runtime.provider === "claude-code",
      `${label}.runtime.provider must be "claude-code"`);

    if (agent.type === "orchestrator") {
      check(agent.runtime.kind === "primary-session",
        `${label}.runtime.kind must be "primary-session" for orchestrator agents`);
      check(!Object.hasOwn(agent.runtime, "agentDefinition"),
        `${label}.runtime must not declare agentDefinition for the primary session`);
      mappings.push({ agentId: agent.id, kind: agent.runtime.kind });
      continue;
    }

    check(agent.type === "worker", `${label}.type is unsupported for runtime mapping`);
    check(agent.runtime.kind === "custom-agent",
      `${label}.runtime.kind must be "custom-agent" for worker agents`);
    check(typeof agent.runtime.agentDefinition === "string" &&
      /^[a-z][a-z0-9-]*$/.test(agent.runtime.agentDefinition),
    `${label}.runtime.agentDefinition must be a kebab-case custom-agent name`);
    check(!definitionNames.has(agent.runtime.agentDefinition),
      `Duplicate runtime agent definition: ${agent.runtime.agentDefinition}`);
    definitionNames.add(agent.runtime.agentDefinition);

    check(typeof agent.profile === "string" && agent.profile.trim(),
      `${label}.profile is required for custom-agent runtime mapping`);
    const profilePath = resolve(repositoryRoot, agent.profile);
    check(!isAbsolute(agent.profile) && isContainedPath(repositoryRoot, profilePath),
      `${label}.profile escapes repository root`);

    let content;
    try {
      content = await readFile(profilePath, "utf8");
    } catch (error) {
      throw new Error(`Cannot read runtime profile for "${agent.id}": ${error.message}`);
    }
    const profile = parseAgentFrontmatter(content, agent.id);
    check(profile.name === agent.runtime.agentDefinition,
      `Runtime definition mismatch for "${agent.id}": registry maps "${agent.runtime.agentDefinition}" but profile name is "${profile.name}"`);

    const writeTools = new Set(["Write", "Edit", "NotebookEdit"]);
    if (agent.permissions.sourceAccess === "read-only") {
      const forbidden = profile.tools.filter((tool) => writeTools.has(tool));
      check(forbidden.length === 0,
        `Read-only agent "${agent.id}" has write-capable tool(s): ${forbidden.join(", ")}`);
    }
    if (agent.permissions.shell === "deny") {
      check(!profile.tools.includes("Bash"),
        `Agent "${agent.id}" declares shell: deny but profile allows Bash`);
    }
    mappings.push({
      agentId: agent.id,
      kind: agent.runtime.kind,
      agentDefinition: profile.name,
      declaredToolCount: profile.tools.length,
    });
  }

  return { valid: true, mappedAgentCount: mappings.length, mappings };
}
