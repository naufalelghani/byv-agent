import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { inspectApiOnlyEnvironment } from "../scripts/byv-runtime-doctor.mjs";
import { validateAgentRuntimeMappings } from "../scripts/agent-runtime-mapping-core.mjs";

const root = REPOSITORY_ROOT;

test("API-only preflight accepts an explicit API key without account login assumptions", () => {
  const result = inspectApiOnlyEnvironment({
    ANTHROPIC_API_KEY: "not-a-real-secret",
  });
  assert.equal(result.status, "configuration_preflight_passed");
  assert.equal(result.accountLoginRequired, false);
  assert.equal(result.credentials.apiKeyPresent, true);
  assert.equal(result.networkRequestPerformed, false);
  assert.equal(result.activeCredentialSourceVerified, false);
  assert.equal(JSON.stringify(result).includes("not-a-real-secret"), false);
});

test("API-only preflight fails closed when neither explicit API key nor custom endpoint credentials exist", () => {
  const result = inspectApiOnlyEnvironment({});
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "API_KEY_MISSING"));
});

test("custom endpoint fails when credentials, model ID, or protocol are missing", () => {
  const result = inspectApiOnlyEnvironment({
    ANTHROPIC_BASE_URL: "https://gateway.example.test/anthropic",
  });
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("API_CREDENTIAL_MISSING"));
  assert.ok(codes.includes("MODEL_ID_MISSING"));
  assert.ok(codes.includes("PROTOCOL_NOT_DECLARED"));
});

test("custom endpoint accepts explicit credential, model, and declared Messages protocol", () => {
  const result = inspectApiOnlyEnvironment({
    ANTHROPIC_BASE_URL: "https://gateway.example.test/anthropic",
    ANTHROPIC_AUTH_TOKEN: "not-a-real-secret",
    ANTHROPIC_MODEL: "vendor-model-2026",
    BYV_PROVIDER_PROTOCOL: "translated-anthropic-messages",
    BYV_PROVIDER_PROFILE_ID: "my-gateway",
  });
  assert.equal(result.status, "configuration_preflight_passed");
  assert.equal(result.providerProfileId, "my-gateway");
  assert.equal(result.model.id, "vendor-model-2026");
  assert.equal(result.providerVerification, "unverified");
  assert.equal(JSON.stringify(result).includes("not-a-real-secret"), false);
});

test("custom endpoint rejects credentials embedded in URL and insecure remote HTTP URLs", () => {
  const embedded = inspectApiOnlyEnvironment({
    ANTHROPIC_BASE_URL: "https://user:password@gateway.example.test/api",
    ANTHROPIC_API_KEY: "not-a-real-secret",
    ANTHROPIC_MODEL: "vendor-model",
    BYV_PROVIDER_PROTOCOL: "anthropic-messages",
  });
  assert.equal(embedded.status, "blocked");
  assert.ok(embedded.issues.some((issue) => issue.code === "INVALID_BASE_URL"));

  const http = inspectApiOnlyEnvironment({
    ANTHROPIC_BASE_URL: "http://gateway.example.test/api",
    ANTHROPIC_API_KEY: "not-a-real-secret",
    ANTHROPIC_MODEL: "vendor-model",
    BYV_PROVIDER_PROTOCOL: "anthropic-messages",
  });
  assert.ok(http.issues.some((issue) => issue.code === "INSECURE_BASE_URL"));
});

test("maps every registry worker to its profile and checks declared tool boundaries", async () => {
  const { registry } = await loadValidatedRegistry();
  const result = await validateAgentRuntimeMappings({ registry, root });
  assert.equal(result.valid, true);
  assert.equal(result.mappedAgentCount, 5);
  assert.equal(result.mappings.find((item) => item.agentId === "byval").kind, "primary-session");
  assert.equal(result.mappings.find((item) => item.agentId === "sam").agentDefinition, "planning-research");
  assert.equal(result.mappings.find((item) => item.agentId === "morgan").agentDefinition, "security-qa");
});

test("runtime mapping rejects absent or mismatched custom-agent names", async () => {
  const { registry } = await loadValidatedRegistry();
  const missing = structuredClone(registry);
  delete missing.agents.find((agent) => agent.id === "sam").runtime.agentDefinition;
  await assert.rejects(
    validateAgentRuntimeMappings({ registry: missing, root }),
    /runtime is missing required field\(s\): agentDefinition/,
  );

  const mismatch = structuredClone(registry);
  mismatch.agents.find((agent) => agent.id === "sam").runtime.agentDefinition = "wrong-name";
  await assert.rejects(
    validateAgentRuntimeMappings({ registry: mismatch, root }),
    /Runtime definition mismatch for "sam"/,
  );
});

test("provider profile example is valid JSON and contains no secret values", async () => {
  const example = JSON.parse(await readFile(resolve(root, "config/provider-profiles.example.json"), "utf8"));
  const schema = JSON.parse(await readFile(resolve(root, "config/provider-profiles.schema.json"), "utf8"));
  assert.equal(example.schemaVersion, schema.properties.schemaVersion.const);
  assert.equal(example.profiles.length, 1);
  assert.equal(example.profiles[0].verificationStatus, "unverified");
  assert.equal(JSON.stringify(example).includes("sk-ant-"), false);
  assert.deepEqual(example.profiles[0].credentialEnv, ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]);
});
