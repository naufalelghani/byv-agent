#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `BYV Agent runtime configuration doctor

Usage:
  node scripts/byv-runtime-doctor.mjs --api-only [--json]
  node scripts/byv-runtime-doctor.mjs --help

Checks explicit API/gateway environment configuration without contacting a provider.
It never prints credential values and does not prove that a live request will succeed.

For a custom endpoint, configure:
  ANTHROPIC_BASE_URL
  ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
  ANTHROPIC_MODEL
  BYV_PROVIDER_PROTOCOL=anthropic-messages
    or translated-anthropic-messages (only when a tested adapter translates the protocol)`;

function nonEmptyEnv(name, env) {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function addIssue(issues, code, message) {
  issues.push({ code, message });
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function inspectApiOnlyEnvironment(env = process.env) {
  const issues = [];
  const baseUrlValue = nonEmptyEnv("ANTHROPIC_BASE_URL", env);
  const apiKeyPresent = Boolean(nonEmptyEnv("ANTHROPIC_API_KEY", env));
  const authTokenPresent = Boolean(nonEmptyEnv("ANTHROPIC_AUTH_TOKEN", env));
  const modelId = nonEmptyEnv("ANTHROPIC_MODEL", env);
  const profileId = nonEmptyEnv("BYV_PROVIDER_PROFILE_ID", env) ?? "api-env";
  const customEndpoint = Boolean(baseUrlValue);
  let endpointHost = "api.anthropic.com";
  let protocol = "anthropic-messages";

  if (customEndpoint) {
    try {
      const url = new URL(baseUrlValue);
      checkUrlCredentials(url);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
        addIssue(issues, "INSECURE_BASE_URL", "ANTHROPIC_BASE_URL must use HTTPS (HTTP is allowed only for a loopback development endpoint).");
      }
      endpointHost = url.host;
    } catch (error) {
      addIssue(issues, "INVALID_BASE_URL", `ANTHROPIC_BASE_URL is not a safe absolute HTTP(S) URL: ${error.message}`);
    }

    protocol = nonEmptyEnv("BYV_PROVIDER_PROTOCOL", env) ?? "";
    if (!["anthropic-messages", "translated-anthropic-messages"].includes(protocol)) {
      addIssue(issues, "PROTOCOL_NOT_DECLARED",
        "Custom endpoint requires BYV_PROVIDER_PROTOCOL=anthropic-messages or translated-anthropic-messages.");
    }
    if (!apiKeyPresent && !authTokenPresent) {
      addIssue(issues, "API_CREDENTIAL_MISSING",
        "Custom endpoint requires ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. A base URL alone does not enable API-only authentication.");
    }
    if (!modelId) {
      addIssue(issues, "MODEL_ID_MISSING",
        "Custom endpoint requires an explicit ANTHROPIC_MODEL value so model routing is not inferred.");
    }
  } else {
    if (!apiKeyPresent) {
      addIssue(issues, "API_KEY_MISSING",
        "API-only mode requires ANTHROPIC_API_KEY when no custom base URL is configured. A saved account login is not accepted as a substitute.");
    }
    if (authTokenPresent && !apiKeyPresent) {
      addIssue(issues, "AUTH_TOKEN_WITHOUT_GATEWAY",
        "ANTHROPIC_AUTH_TOKEN alone is intended for an explicitly configured gateway; set ANTHROPIC_BASE_URL or provide ANTHROPIC_API_KEY.");
    }
    if (modelId && /^(?:default|sonnet|opus|haiku|opusplan)$/i.test(modelId)) {
      // Aliases are legal for some Anthropic targets, but not reliable proof of a third-party model ID.
      protocol = "anthropic-messages";
    }
  }

  if (!/^[a-z][a-z0-9-]{0,63}$/.test(profileId)) {
    addIssue(issues, "INVALID_PROFILE_ID", "BYV_PROVIDER_PROFILE_ID must be a kebab-case identifier of at most 64 characters.");
  }

  return {
    mode: "api-only",
    status: issues.length === 0 ? "configuration_preflight_passed" : "blocked",
    endpoint: { custom: customEndpoint, host: endpointHost },
    providerProfileId: profileId,
    protocol: protocol || null,
    model: { explicit: Boolean(modelId), id: modelId ?? null },
    credentials: {
      apiKeyPresent,
      authTokenPresent,
      valuesRedacted: true,
    },
    accountLoginRequired: false,
    networkRequestPerformed: false,
    activeCredentialSourceVerified: false,
    manualClaudeStatusCheckRequired: true,
    providerVerification: customEndpoint ? "unverified" : "not-tested",
    issues,
    notes: [
      "This is environment preflight only; it does not contact the endpoint or verify billing.",
      "Confirm the active credential source with Claude Code /status and run a real model request.",
      "Third-party model support is best-effort and requires endpoint/model-specific compatibility tests.",
    ],
  };
}

function checkUrlCredentials(url) {
  if (url.username || url.password) throw new Error("URL must not contain embedded username/password credentials");
  if (url.search || url.hash) throw new Error("URL must not contain query parameters or fragments");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("URL protocol must be HTTP or HTTPS");
}

function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(USAGE);
    return;
  }
  const json = argv.includes("--json");
  const known = argv.filter((arg) => arg !== "--json");
  if (known.length !== 1 || known[0] !== "--api-only") {
    throw new Error(`Use --api-only (and optionally --json).\n\n${USAGE}`);
  }

  const result = inspectApiOnlyEnvironment(env);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`BYV API-only preflight: ${result.status}`);
    console.log(`Endpoint: ${result.endpoint.host} (${result.endpoint.custom ? "custom" : "default Anthropic API"})`);
    console.log(`Profile: ${result.providerProfileId}; protocol: ${result.protocol ?? "not declared"}`);
    console.log(`Model explicitly set: ${result.model.explicit ? "yes" : "no"}`);
    console.log(`Credentials: API key ${result.credentials.apiKeyPresent ? "present" : "absent"}; auth token ${result.credentials.authTokenPresent ? "present" : "absent"}`);
    console.log("Credential values: redacted");
    for (const issue of result.issues) console.error(`[${issue.code}] ${issue.message}`);
    for (const note of result.notes) console.log(`NOTE: ${note}`);
  }
  if (result.status !== "configuration_preflight_passed") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`BYV runtime doctor failed: ${error.message}`);
    process.exitCode = 2;
  }
}
