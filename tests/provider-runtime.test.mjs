import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadValidatedRegistry, REPOSITORY_ROOT } from "../scripts/agent-registry-core.mjs";
import { inspectApiOnlyEnvironment } from "../scripts/byv-runtime-doctor.mjs";
import { validateAgentRuntimeMappings } from "../scripts/agent-runtime-mapping-core.mjs";
import { validateProviderProfiles } from "../scripts/provider-profile-core.mjs";

const root = REPOSITORY_ROOT;
const doctorPath = resolve(root, "scripts/byv-runtime-doctor.mjs");
const profilesCliPath = resolve(root, "scripts/validate-provider-profiles.mjs");

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
  const result = validateProviderProfiles(example, schema);
  assert.equal(result.valid, true);
  assert.equal(example.profiles.length, 2);
  assert.ok(example.profiles.every((profile) => profile.verificationStatus === "unverified"));
  assert.equal(JSON.stringify(example).includes("sk-ant-"), false);
  assert.deepEqual(
    example.profiles.find((profile) => profile.id === "custom-gateway-example").credentialEnv,
    ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"],
  );

  const unsafe = structuredClone(example);
  unsafe.profiles[0].apiKey = "must-not-be-present";
  assert.throws(() => validateProviderProfiles(unsafe, schema), /unsupported field/);
});

test("API-only doctor CLI redacts credentials and exits successfully for explicit API configuration", () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: "test-secret-value" };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const result = spawnSync(process.execPath, [doctorPath, "--api-only", "--json"], {
    cwd: root, encoding: "utf8", env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "configuration_preflight_passed");
  assert.equal(output.activeCredentialSourceVerified, false);
  assert.equal(result.stdout.includes("test-secret-value"), false);
  assert.equal(result.stderr.includes("test-secret-value"), false);
});

test("API-only doctor CLI blocks missing credentials without using saved account login as a fallback", () => {
  const env = { ...process.env };
  for (const key of [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL", "BYV_PROVIDER_PROTOCOL", "BYV_PROVIDER_PROFILE_ID",
  ]) delete env[key];
  const result = spawnSync(process.execPath, [doctorPath, "--api-only", "--json"], {
    cwd: root, encoding: "utf8", env,
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked");
  assert.ok(output.issues.some((issue) => issue.code === "API_KEY_MISSING"));
});

test("provider profile CLI validates the bundled secret-free example", () => {
  const result = spawnSync(process.execPath, [profilesCliPath], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.profileCount, 2);
  assert.equal(output.secretValuesRead, false);
  assert.equal(output.endpointRequestPerformed, false);
});

test("runtime mapping rejects read-only and shell-denied tool allowlist conflicts", async () => {
  const rootDir = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), "byv-runtime-mapping-")));
  const profilePath = join(rootDir, "sam.md");
  const base = {
    agents: [{
      id: "sam",
      type: "worker",
      profile: "sam.md",
      runtime: { provider: "claude-code", kind: "custom-agent", agentDefinition: "planning-research" },
      permissions: { sourceAccess: "read-only", shell: "deny", network: "deny" },
    }],
  };
  try {
    await writeFile(profilePath, "---\nname: planning-research\ndescription: test\ntools: Read, Write\n---\nTest profile\n", "utf8");
    await assert.rejects(
      validateAgentRuntimeMappings({ registry: base, root: rootDir }),
      /Read-only agent "sam" has write-capable tool/,
    );
    await writeFile(profilePath, "---\nname: planning-research\ndescription: test\ntools: Read, Bash\n---\nTest profile\n", "utf8");
    await assert.rejects(
      validateAgentRuntimeMappings({ registry: base, root: rootDir }),
      /shell: deny but profile allows Bash/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
