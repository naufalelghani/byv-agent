# P3 — Inter-Agent Messaging

**Status:** Implementation on review branch; real transport is intentionally out of scope  
**Source of truth:** \`agents/registry.json\`

## Purpose and runtime boundary

P3 defines a versioned, strict message envelope, validates sender and recipient identities against the checked registry, applies the existing delegation policy to task messages, and prepares a normalized delivery plan. This is a validation and routing-preparation layer only: it does not send a message, start an agent, persist task state, authenticate a network caller, or enforce host shell/network permissions. A runtime transport and task ledger are future integration points.

## Message envelope

Every input message must contain exactly these top-level fields:

| Field | Contract |
|---|---|
| \`messageVersion\` | Must be \`1.0.0\` |
| \`messageId\` | Unique message identifier supplied by the caller |
| \`correlationId\` | Identifier joining messages in the same conversation/workflow |
| \`taskId\` | Identifier of the task this message concerns |
| \`sentAt\` | ISO-8601 timestamp including a timezone |
| \`senderId\` | Enabled agent ID from the registry |
| \`recipientId\` | Different, enabled agent ID from the registry |
| \`type\` | One of \`task\`, \`result\`, \`status\`, \`error\`, \`ack\` |
| \`payload\` | Strict, type-specific object |

Identifiers are trimmed and limited to 1–128 letters, digits, dots, underscores, colons, or hyphens. Unknown envelope fields are rejected.

## Payload contracts

- \`task\`: \`description\`, \`expectedOutput\`, and non-empty \`acceptanceCriteria\` are required. Optional \`relevantContext\` is a list of non-empty strings. Existing delegation rules must allow the sender to delegate to the recipient.
- \`result\`: \`status\` is \`completed\`, \`partial\`, or \`blocked\`; \`summary\` is required. Optional \`output\` and \`artifacts\` contain non-empty text.
- \`status\`: \`status\` is \`accepted\`, \`in_progress\`, \`completed\`, or \`blocked\`. Optional \`detail\` is non-empty text.
- \`error\`: requires a non-empty \`code\`, non-empty \`message\`, and boolean \`retryable\`.
- \`ack\`: requires \`acknowledgedMessageId\`.

Task/result/status/error/ack payloads reject extra fields. Reply-style messages may travel from a registered worker to a registered orchestrator; only new \`task\` messages are checked against \`delegation.canDelegate\` and \`delegation.allowedTargets\`. No task history exists yet, so this layer cannot prove that a correlation or acknowledgement refers to a previously delivered message.

## CLI

Create a UTF-8 JSON file containing the envelope, then run from the repository root:

\`\`\`sh
node scripts/validate-agent-message.mjs ./message.json
\`\`\`

The command prints a normalized message and a delivery plan:

\`\`\`json
{
  "deliveryPlan": {
    "recipientAgentId": "sam",
    "status": "validated_not_dispatched"
  }
}
\`\`\`

A non-zero exit code indicates invalid JSON, unsupported fields/types, an invalid timestamp/identifier, an unknown or disabled agent, or a policy violation. \`node scripts/validate-agent-message.mjs --help\` prints usage.

## Verification

\`\`\`sh
node scripts/validate-agent-registry.mjs
node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs tests/delegation-validation.test.mjs tests/agent-message.test.mjs
\`\`\`
