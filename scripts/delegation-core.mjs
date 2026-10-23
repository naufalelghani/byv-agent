function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  check(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function requireKeys(value, requiredKeys, allowedKeys, label) {
  check(isObject(value), `${label} must be an object`);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  check(missing.length === 0, `${label} is missing required field(s): ${missing.join(", ")}`);
  check(unsupported.length === 0, `${label} contains unsupported field(s): ${unsupported.join(", ")}`);
}

function validateTaskPayload(value) {
  const required = ["description", "expectedOutput", "acceptanceCriteria"];
  const allowed = [...required, "relevantContext"];
  requireKeys(value, required, allowed, "taskPayload");

  requireNonEmptyString(value.description, "taskPayload.description");
  requireNonEmptyString(value.expectedOutput, "taskPayload.expectedOutput");
  check(
    Array.isArray(value.acceptanceCriteria) &&
      value.acceptanceCriteria.length > 0 &&
      value.acceptanceCriteria.every((item) => typeof item === "string" && item.trim().length > 0),
    "taskPayload.acceptanceCriteria must be a non-empty array of non-empty strings",
  );

  const relevantContext = Object.hasOwn(value, "relevantContext") ? value.relevantContext : [];
  check(
    Array.isArray(relevantContext) &&
      relevantContext.every((item) => typeof item === "string" && item.trim().length > 0),
    "taskPayload.relevantContext must be an array of non-empty strings",
  );

  return {
    description: value.description.trim(),
    expectedOutput: value.expectedOutput.trim(),
    acceptanceCriteria: value.acceptanceCriteria.map((item) => item.trim()),
    relevantContext: relevantContext.map((item) => item.trim()),
  };
}

/**
 * Validate whether one registered agent may delegate a well-formed task to another.
 * Registry loading/schema validation is intentionally handled by the caller.
 */
export function validateDelegationRequest({ registry, request }) {
  check(isObject(registry) && Array.isArray(registry.agents), "Validated registry data is required");
  requireKeys(
    request,
    ["requestingAgentId", "targetAgentId", "taskPayload"],
    ["requestingAgentId", "targetAgentId", "taskPayload"],
    "delegation request",
  );
  requireNonEmptyString(request.requestingAgentId, "requestingAgentId");
  requireNonEmptyString(request.targetAgentId, "targetAgentId");

  const task = validateTaskPayload(request.taskPayload);
  const requester = registry.agents.find((agent) => agent.id === request.requestingAgentId.trim());
  if (!requester) throw new Error(`Unknown parent agent id: ${request.requestingAgentId}`);
  if (!requester.enabled) throw new Error(`Parent agent "${requester.id}" is disabled`);

  const target = registry.agents.find((agent) => agent.id === request.targetAgentId.trim());
  if (!target) throw new Error(`Unknown agent id: ${request.targetAgentId}`);
  if (!target.enabled) throw new Error(`Agent "${target.id}" is disabled`);
  if (requester.id === target.id) {
    throw new Error("An agent cannot bootstrap itself as its own child");
  }
  if (!requester.delegation || requester.delegation.canDelegate !== true) {
    throw new Error(`Parent agent "${requester.id}" is not permitted to delegate`);
  }
  if (!Array.isArray(requester.delegation.allowedTargets) ||
      !requester.delegation.allowedTargets.includes(target.id)) {
    throw new Error(`Parent agent "${requester.id}" is not allowed to delegate to "${target.id}"`);
  }

  return {
    delegationVersion: "1.0.0",
    requester: { id: requester.id, name: requester.name },
    target: {
      id: target.id,
      name: target.name,
      role: target.role,
      capabilities: [...target.capabilities],
    },
    task,
  };
}
