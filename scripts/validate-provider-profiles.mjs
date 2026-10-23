#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProviderProfiles } from "./provider-profile-core.mjs";

const DEFAULT_CONFIG = "config/provider-profiles.example.json";
const SCHEMA_PATH = "config/provider-profiles.schema.json";
const USAGE = `BYV provider profile metadata validator

Usage:
  node scripts/validate-provider-profiles.mjs [profile-config.json]
  node scripts/validate-provider-profiles.mjs --help

Validates non-secret provider metadata only. It does not contact a model endpoint.`;

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read or parse ${label}: ${error.message}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(USAGE);
    return;
  }
  if (argv.length > 1 || (argv[0] && argv[0].startsWith("--"))) {
    throw new Error(USAGE);
  }
  const configPath = resolve(process.cwd(), argv[0] ?? DEFAULT_CONFIG);
  const schemaPath = resolve(process.cwd(), SCHEMA_PATH);
  const [config, schema] = await Promise.all([
    readJson(configPath, "provider profile config"),
    readJson(schemaPath, "provider profile schema"),
  ]);
  const result = validateProviderProfiles(config, schema);
  console.log(JSON.stringify({
    ...result,
    configPath: argv[0] ?? DEFAULT_CONFIG,
    secretValuesRead: false,
    endpointRequestPerformed: false,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Provider profile validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
