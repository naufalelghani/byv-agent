#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadValidatedRegistry } from "./agent-registry-core.mjs";
import { validateAgentMessage } from "./agent-message-core.mjs";

const USAGE = `BYV Agent message envelope validator

Usage:
  node scripts/validate-agent-message.mjs <message.json>
  node scripts/validate-agent-message.mjs --help

Reads a JSON message envelope, validates sender/recipient against the agent registry,
and prints a normalized message plus a delivery plan. It does not dispatch messages.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  if (args.length !== 1 || args[0].startsWith("--")) {
    throw new Error(`Provide exactly one JSON file path.\n\n${USAGE}`);
  }

  const messagePath = resolve(process.cwd(), args[0]);
  let message;
  try {
    message = JSON.parse(await readFile(messagePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read or parse message file: ${error.message}`);
  }

  const { registry } = await loadValidatedRegistry();
  const result = validateAgentMessage({ registry, message });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Agent message validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
