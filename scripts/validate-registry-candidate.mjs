#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadValidatedRegistry, REPOSITORY_ROOT, validateRegistryData } from "./agent-registry-core.mjs";
import { digestRegistry } from "./agent-registry-runtime.mjs";

const USAGE = `BYV Agent registry candidate validator

Usage:
  node scripts/validate-registry-candidate.mjs <candidate.json>
  node scripts/validate-registry-candidate.mjs --help

Validates a candidate registry against the checked-in schema, registry policy,
and profile files. It does not activate the candidate or modify registry.json.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  if (args.length !== 1 || args[0].startsWith("--")) {
    throw new Error(`Provide exactly one candidate JSON file path.\n\n${USAGE}`);
  }

  const candidatePath = resolve(process.cwd(), args[0]);
  let candidate;
  try {
    candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read or parse candidate registry: ${error.message}`);
  }

  const { schema } = await loadValidatedRegistry({ root: REPOSITORY_ROOT });
  await validateRegistryData(candidate, schema, REPOSITORY_ROOT);
  console.log(JSON.stringify({
    valid: true,
    candidateStatus: "valid_not_activated",
    registryId: candidate.registryId,
    schemaVersion: candidate.schemaVersion,
    agentCount: candidate.agents.length,
    sha256: digestRegistry(candidate),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Registry candidate validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
