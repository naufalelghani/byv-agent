# P0 — Agent Registry Core

This milestone establishes a validated, deterministic, static registry as the source of truth for agent identity and routing metadata. It does not implement spawning, host permission enforcement, message transport, dynamic reload, or bootstrap injection; those are later milestones.

## Registry contract

- Canonical data: `agents/registry.json`
- JSON Schema: `agents/registry.schema.json` (Draft 2020-12; schema version `1.0.0`)
- Validator: `scripts/validate-agent-registry.mjs` (Node.js built-ins only)
- Tests: `node --test tests/agent-registry.test.mjs`

The validator checks identifier format and uniqueness, required metadata, capability and permission enums, profile existence and repository containment, delegation targets, self-delegation, and consistency between `canDelegate` and `allowedTargets`.

## Run checks

From repository root, with Node.js installed:

```sh
node scripts/validate-agent-registry.mjs
node --test tests/agent-registry.test.mjs
```

A successful validator reports the registry id, schema version, and agent count. These checks validate repository metadata only; they do not prove host runtime behavior or enforce security boundaries.
