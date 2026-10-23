const PROFILE_KEYS = [
  "id", "endpointMode", "protocol", "baseUrlEnv", "modelIdEnv",
  "credentialEnv", "verificationStatus", "capabilities", "notes",
];
const CAPABILITY_KEYS = ["streaming", "toolUse", "agentTeams"];
const PROTOCOLS = new Set(["anthropic-messages", "translated-anthropic-messages"]);
const MODES = new Set(["direct-api", "third-party-endpoint"]);
const VERIFICATION = new Set(["unverified", "endpoint-reachable", "messages-compatible", "agentic-verified"]);
const CAPABILITY_STATUS = new Set(["unverified", "supported", "unsupported"]);
const CREDENTIAL_VARS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  check(isObject(value), `${label} must be an object`);
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  check(missing.length === 0, `${label} is missing required field(s): ${missing.join(", ")}`);
  check(extra.length === 0, `${label} contains unsupported field(s): ${extra.join(", ")}`);
}

function envName(value, label, allowNull = false) {
  if (allowNull && value === null) return;
  check(typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value),
    `${label} must be an uppercase environment variable name`);
}

export function validateProviderProfiles(config, schema) {
  exactKeys(config, ["schemaVersion", "profiles"], "providerProfiles");
  check(isObject(schema) && isObject(schema.properties?.schemaVersion),
    "Provider profile schema is missing schemaVersion contract");
  check(config.schemaVersion === schema.properties.schemaVersion.const,
    "Unsupported provider profile schemaVersion");
  check(Array.isArray(config.profiles) && config.profiles.length > 0,
    "providerProfiles.profiles must be a non-empty array");

  const ids = new Set();
  for (const [index, profile] of config.profiles.entries()) {
    const label = `providerProfiles.profiles[${index}]`;
    exactKeys(profile, PROFILE_KEYS, label);
    check(typeof profile.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(profile.id),
      `${label}.id must be a kebab-case identifier of at most 64 characters`);
    check(!ids.has(profile.id), `Duplicate provider profile id: ${profile.id}`);
    ids.add(profile.id);
    check(MODES.has(profile.endpointMode), `${label}.endpointMode is invalid`);
    check(PROTOCOLS.has(profile.protocol), `${label}.protocol is invalid`);
    if (profile.endpointMode === "direct-api") {
      check(profile.protocol === "anthropic-messages",
        `${label} direct-api must use anthropic-messages protocol`);
      check(profile.baseUrlEnv === null,
        `${label} direct-api baseUrlEnv must be null`);
      check(profile.credentialEnv?.includes("ANTHROPIC_API_KEY"),
        `${label} direct-api must declare ANTHROPIC_API_KEY`);
    } else {
      envName(profile.baseUrlEnv, `${label}.baseUrlEnv`);
    }
    envName(profile.modelIdEnv, `${label}.modelIdEnv`);
    check(Array.isArray(profile.credentialEnv) && profile.credentialEnv.length > 0,
      `${label}.credentialEnv must be a non-empty array`);
    check(profile.credentialEnv.every((name) => CREDENTIAL_VARS.has(name)),
      `${label}.credentialEnv contains an unsupported credential variable`);
    check(new Set(profile.credentialEnv).size === profile.credentialEnv.length,
      `${label}.credentialEnv must contain unique variable names`);
    check(VERIFICATION.has(profile.verificationStatus),
      `${label}.verificationStatus is invalid`);
    exactKeys(profile.capabilities, CAPABILITY_KEYS, `${label}.capabilities`);
    for (const key of CAPABILITY_KEYS) {
      check(CAPABILITY_STATUS.has(profile.capabilities[key]),
        `${label}.capabilities.${key} is invalid`);
    }
    check(typeof profile.notes === "string", `${label}.notes must be a string`);
    if (profile.verificationStatus === "agentic-verified") {
      check(profile.capabilities.streaming === "supported" &&
        profile.capabilities.toolUse === "supported" &&
        profile.capabilities.agentTeams === "supported",
      `${label} agentic-verified requires streaming, toolUse, and agentTeams to be supported`);
    }
    if (profile.verificationStatus === "messages-compatible" ||
        profile.verificationStatus === "agentic-verified") {
      check(profile.capabilities.streaming === "supported" &&
        profile.capabilities.toolUse === "supported",
      `${label} message compatibility requires streaming and toolUse to be supported`);
    }
    // Profiles are metadata only. Credential values are never allowed as fields.
    for (const forbidden of ["apiKey", "api_key", "token", "secret", "password", "authorization"]) {
      check(!Object.keys(profile).some((key) => key.toLowerCase() === forbidden.toLowerCase()),
        `${label} must not contain credential values or secret fields`);
    }
  }
  return { valid: true, profileCount: config.profiles.length, profileIds: [...ids] };
}
