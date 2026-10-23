#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "./agent-registry-core.mjs";
import { validateDelegationRequest } from "./delegation-core.mjs";

const USAGE = `BYV Agent bootstrap packet generator

Usage:
  node scripts/bootstrap-agent.mjs --agent <id> --task <text> --expected-output <text> --acceptance <criterion> [options]

Options:
  --parent <id>        Parent agent authorizing this bootstrap (required for workers)
  --acceptance <text>  Verifiable acceptance criterion; repeat for multiple criteria
  --context <text>     Relevant file, decision, interface, or constraint; repeat as needed
  --help               Show this help

The command validates the registry and delegation policy, then writes a JSON bootstrap packet to stdout.
It prepares context for a host to inject; it does not spawn a subagent or enforce host permissions.`;

function parseArguments(argv) {
  const options = { acceptanceCriteria: [], relevantContext: [] };
  const singleValueOptions = new Map([
    ["--agent", "agentId"],
    ["--parent", "parentAgentId"],
    ["--task", "task"],
    ["--expected-output", "expectedOutput"],
  ]);
  const repeatableOptions = new Map([
    ["--acceptance", "acceptanceCriteria"],
    ["--context", "relevantContext"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--help") return { help: true };
    if (!singleValueOptions.has(option) && !repeatableOptions.has(option)) {
      throw new Error(`Unknown option: ${option}\n\n${USAGE}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}\n\n${USAGE}`);
    }
    index += 1;

    if (repeatableOptions.has(option)) {
      options[repeatableOptions.get(option)].push(value);
    } else {
      const key = singleValueOptions.get(option);
      if (Object.hasOwn(options, key)) {
        throw new Error(`Option ${option} was supplied more than once`);
      }
      options[key] = value;
    }
  }

  for (const [key, option] of [
    ["agentId", "--agent"],
    ["task", "--task"],
    ["expectedOutput", "--expected-output"],
  ]) {
    if (typeof options[key] !== "string" || !options[key].trim()) {
      throw new Error(`Missing required option: ${option}\n\n${USAGE}`);
    }
  }
  if (options.acceptanceCriteria.length === 0) {
    throw new Error(`At least one --acceptance criterion is required\n\n${USAGE}`);
  }

  return options;
}

/**
 * Build startup context for a host-supported agent spawn.
 * The caller must provide registry data that passed loadValidatedRegistry().
 */
export async function createBootstrapPacket({
  registry,
  root = REPOSITORY_ROOT,
  agentId,
  parentAgentId,
  task,
  expectedOutput,
  acceptanceCriteria,
  relevantContext = [],
}) {
  const requireText = (value, name) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${name} must be a non-empty string`);
    }
  };

  requireText(agentId, "agentId");
  requireText(task, "task");
  requireText(expectedOutput, "expectedOutput");
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0 ||
      !acceptanceCriteria.every((item) => typeof item === "string" && item.trim())) {
    throw new Error("At least one non-empty acceptance criterion is required");
  }
  if (!Array.isArray(relevantContext) ||
      !relevantContext.every((item) => typeof item === "string" && item.trim())) {
    throw new Error("relevantContext must contain only non-empty strings");
  }

  const agents = registry?.agents;
  if (!Array.isArray(agents)) throw new Error("Validated registry data is required");
  const agent = agents.find((entry) => entry.id === agentId);
  if (!agent) throw new Error(`Unknown agent id: ${agentId}`);
  if (!agent.enabled) throw new Error(`Agent "${agentId}" is disabled`);

  let parent = null;
  if (parentAgentId !== undefined && parentAgentId !== null && parentAgentId !== "") {
    if (typeof parentAgentId !== "string") {
      throw new Error("parentAgentId must be a non-empty string when supplied");
    }
    const parentId = parentAgentId.trim();
    if (!parentId) throw new Error("parentAgentId must be a non-empty string when supplied");
    const validatedDelegation = validateDelegationRequest({
      registry,
      request: {
        requestingAgentId: parentId,
        targetAgentId: agent.id,
        taskPayload: {
          description: task,
          expectedOutput,
          acceptanceCriteria,
          relevantContext,
        },
      },
    });
    parent = agents.find((entry) => entry.id === validatedDelegation.requester.id);
  } else if (agent.type !== "orchestrator") {
    throw new Error(`Parent agent id is required when bootstrapping worker "${agentId}"`);
  }

  let profileContent = null;
  if (agent.profile !== null) {
    try {
      profileContent = await readFile(resolve(root, agent.profile), "utf8");
    } catch (error) {
      throw new Error(`Unable to load profile for "${agentId}" at "${agent.profile}": ${error.message}`);
    }
    if (!profileContent.trim()) {
      throw new Error(`Profile for "${agentId}" is empty: ${agent.profile}`);
    }
  }

  return {
    packetVersion: "1.0.0",
    registry: { id: registry.registryId, schemaVersion: registry.schemaVersion },
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      type: agent.type,
      description: agent.description,
      capabilities: [...agent.capabilities],
      runtime: { ...agent.runtime },
    },
    parentAgentId: parent?.id ?? null,
    task: {
      description: task.trim(),
      expectedOutput: expectedOutput.trim(),
      acceptanceCriteria: acceptanceCriteria.map((item) => item.trim()),
      relevantContext: relevantContext.map((item) => item.trim()),
    },
    profile: { path: agent.profile, content: profileContent },
    permissions: {
      sourceAccess: agent.permissions.sourceAccess,
      shell: agent.permissions.shell,
      network: agent.permissions.network,
      hostPolicy: "Host-enforced controls remain authoritative; registry metadata is not a security sandbox.",
    },
    delegation: {
      canDelegate: agent.delegation.canDelegate,
      allowedTargets: [...agent.delegation.allowedTargets],
    },
    runtimeBoundary: "This packet prepares startup context only. A host/orchestrator must inject it into the actual agent runtime; this script does not spawn agents or enforce shell/network permissions.",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { registry } = await loadValidatedRegistry();
  const packet = await createBootstrapPacket({
    registry,
    root: REPOSITORY_ROOT,
    ...options,
  });
  console.log(JSON.stringify(packet, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Agent bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}
