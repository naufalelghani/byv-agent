import { validateDelegationRequest } from "./delegation-core.mjs";

const MESSAGE_TYPES = ["task", "result", "status", "error", "ack"];
const ENVELOPE_KEYS = [
  "messageVersion", "messageId", "correlationId", "taskId",
  "sentAt", "senderId", "recipientId", "type", "payload",
];

function fail(message) {
  throw new Error(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(value, requiredKeys, allowedKeys, label) {
  check(isObject(value), `${label} must be an object`);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  check(missing.length === 0, `${label} is missing required field(s): ${missing.join(", ")}`);
  check(unsupported.length === 0, `${label} contains unsupported field(s): ${unsupported.join(", ")}`);
}

function requireNonEmptyString(value, label) {
  check(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function requireIdentifier(value, label) {
  requireNonEmptyString(value, label);
  check(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.trim()),
    `${label} must be a 1-128 character identifier using letters, digits, dot, underscore, colon, or hyphen`,
  );
  return value.trim();
}

function normalizedText(value, label) {
  requireNonEmptyString(value, label);
  return value.trim();
}

function validatePayload(type, payload) {
  switch (type) {
    case "task": {
      requireExactKeys(
        payload,
        ["description", "expectedOutput", "acceptanceCriteria"],
        ["description", "expectedOutput", "acceptanceCriteria", "relevantContext"],
        "payload",
      );
      const acceptanceCriteria = payload.acceptanceCriteria;
      check(
        Array.isArray(acceptanceCriteria) &&
          acceptanceCriteria.length > 0 &&
          acceptanceCriteria.every((item) => typeof item === "string" && item.trim().length > 0),
        "payload.acceptanceCriteria must be a non-empty array of non-empty strings",
      );
      const relevantContext = Object.hasOwn(payload, "relevantContext") ? payload.relevantContext : [];
      check(
        Array.isArray(relevantContext) &&
          relevantContext.every((item) => typeof item === "string" && item.trim().length > 0),
        "payload.relevantContext must be an array of non-empty strings",
      );
      return {
        description: normalizedText(payload.description, "payload.description"),
        expectedOutput: normalizedText(payload.expectedOutput, "payload.expectedOutput"),
        acceptanceCriteria: acceptanceCriteria.map((item) => item.trim()),
        relevantContext: relevantContext.map((item) => item.trim()),
      };
    }
    case "result": {
      const required = ["status", "summary"];
      const allowed = [...required, "output", "artifacts"];
      requireExactKeys(payload, required, allowed, "payload");
      check(["completed", "partial", "blocked"].includes(payload.status),
        "payload.status must be completed, partial, or blocked");
      const result = {
        status: payload.status,
        summary: normalizedText(payload.summary, "payload.summary"),
      };
      if (Object.hasOwn(payload, "output")) {
        result.output = normalizedText(payload.output, "payload.output");
      }
      if (Object.hasOwn(payload, "artifacts")) {
        check(
          Array.isArray(payload.artifacts) &&
            payload.artifacts.every((item) => typeof item === "string" && item.trim().length > 0),
          "payload.artifacts must be an array of non-empty strings",
        );
        result.artifacts = payload.artifacts.map((item) => item.trim());
      }
      return result;
    }
    case "status": {
      const required = ["status"];
      const allowed = [...required, "detail"];
      requireExactKeys(payload, required, allowed, "payload");
      check(["accepted", "in_progress", "completed", "blocked"].includes(payload.status),
        "payload.status must be accepted, in_progress, completed, or blocked");
      const result = { status: payload.status };
      if (Object.hasOwn(payload, "detail")) {
        result.detail = normalizedText(payload.detail, "payload.detail");
      }
      return result;
    }
    case "error": {
      requireExactKeys(payload, ["code", "message", "retryable"], ["code", "message", "retryable"], "payload");
      check(typeof payload.retryable === "boolean", "payload.retryable must be a boolean");
      return {
        code: normalizedText(payload.code, "payload.code"),
        message: normalizedText(payload.message, "payload.message"),
        retryable: payload.retryable,
      };
    }
    case "ack": {
      requireExactKeys(
        payload,
        ["acknowledgedMessageId"],
        ["acknowledgedMessageId"],
        "payload",
      );
      return {
        acknowledgedMessageId: requireIdentifier(
          payload.acknowledgedMessageId,
          "payload.acknowledgedMessageId",
        ),
      };
    }
    default:
      fail(`Unsupported message type: ${type}`);
  }
}

/**
 * Validate an inter-agent envelope against the current registry and return a
 * normalized message plus a delivery plan. This function does not dispatch it.
 */
export function validateAgentMessage({ registry, message }) {
  check(isObject(registry) && Array.isArray(registry.agents), "Validated registry data is required");
  requireExactKeys(message, ENVELOPE_KEYS, ENVELOPE_KEYS, "message envelope");

  check(message.messageVersion === "1.0.0", "messageVersion must be 1.0.0");
  const messageId = requireIdentifier(message.messageId, "messageId");
  const correlationId = requireIdentifier(message.correlationId, "correlationId");
  const taskId = requireIdentifier(message.taskId, "taskId");
  requireNonEmptyString(message.sentAt, "sentAt");
  check(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(message.sentAt.trim()) &&
      Number.isFinite(Date.parse(message.sentAt)),
    "sentAt must be a valid ISO-8601 timestamp with a timezone",
  );
  check(MESSAGE_TYPES.includes(message.type), `type must be one of: ${MESSAGE_TYPES.join(", ")}`);

  const senderId = requireIdentifier(message.senderId, "senderId");
  const recipientId = requireIdentifier(message.recipientId, "recipientId");
  check(senderId !== recipientId, "An agent cannot send a message to itself");

  const sender = registry.agents.find((agent) => agent.id === senderId);
  check(sender, `Unknown sender agent id: ${senderId}`);
  check(sender.enabled === true, `Sender agent "${senderId}" is disabled`);
  const recipient = registry.agents.find((agent) => agent.id === recipientId);
  check(recipient, `Unknown recipient agent id: ${recipientId}`);
  check(recipient.enabled === true, `Recipient agent "${recipientId}" is disabled`);

  const payload = validatePayload(message.type, message.payload);
  if (message.type === "task") {
    const delegation = validateDelegationRequest({
      registry,
      request: {
        requestingAgentId: senderId,
        targetAgentId: recipientId,
        taskPayload: payload,
      },
    });
    return {
      message: {
        messageVersion: "1.0.0",
        messageId,
        correlationId,
        taskId,
        sentAt: new Date(message.sentAt).toISOString(),
        sender: { id: sender.id, name: sender.name, role: sender.role },
        recipient: { id: recipient.id, name: recipient.name, role: recipient.role },
        type: message.type,
        payload: delegation.task,
      },
      deliveryPlan: {
        recipientAgentId: recipient.id,
        status: "validated_not_dispatched",
      },
    };
  }

  return {
    message: {
      messageVersion: "1.0.0",
      messageId,
      correlationId,
      taskId,
      sentAt: new Date(message.sentAt).toISOString(),
      sender: { id: sender.id, name: sender.name, role: sender.role },
      recipient: { id: recipient.id, name: recipient.name, role: recipient.role },
      type: message.type,
      payload,
    },
    deliveryPlan: {
      recipientAgentId: recipient.id,
      status: "validated_not_dispatched",
    },
  };
}
