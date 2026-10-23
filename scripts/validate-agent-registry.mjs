#!/usr/bin/env node
import { loadValidatedRegistry } from "./agent-registry-core.mjs";

async function main() {
  const { registry } = await loadValidatedRegistry();
  console.log(`Agent registry valid: ${registry.registryId} (schema ${registry.schemaVersion}), ${registry.agents.length} agents.`);
}

main().catch((error) => {
  console.error(`Agent registry validation failed: ${error.message}`);
  process.exitCode = 1;
});
