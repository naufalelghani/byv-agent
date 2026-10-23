#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadValidatedRegistry } from "./agent-registry-core.mjs";
import { validateDelegationRequest } from "./delegation-core.mjs";

const USAGE = `BYV Agent delegation request validator

Usage:
  node scripts/validate-delegation.mjs --requester <id> --target <id> --task <text> --expected-output <text> --acceptance <criterion> [options]

Options:
  --acceptance <text>  Verifiable acceptance criterion; repeat for multiple criteria
  --context <text>     Relevant context; repeat as needed
  --help               Show this help

The command validates the registry, delegation policy, and task payload. It does not spawn an agent.`;

function parseArguments(argv) {
  const options = { acceptanceCriteria: [], relevantContext: [] };
  const singleValueOptions = new Map([
    ["--requester", "requestingAgentId"],
    ["--target", "targetAgentId"],
    ["--task", "description"],
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
    ["requestingAgentId", "--requester"],
    ["targetAgentId", "--target"],
    ["description", "--task"],
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { registry } = await loadValidatedRegistry();
  const { requestingAgentId, targetAgentId, ...taskPayload } = options;
  const result = validateDelegationRequest({
    registry,
    request: { requestingAgentId, targetAgentId, taskPayload },
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Delegation validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
