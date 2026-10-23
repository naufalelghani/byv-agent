# Agent Registry Bootstrap Contract

**Status:** P1 — orchestration/bootstrap convention  
**Registry:** `agents/registry.json`

## Purpose

The registry is the canonical catalog for agent identity, role, capabilities, profile path, delegation policy, and declared permissions. A registry entry is metadata; it is not an agent runtime, permission enforcement mechanism, or communication transport.

This contract defines what Byval should do when the host supports delegation or subagent spawning. It does not claim that a host automatically loads this file.

## Bootstrap procedure

Before delegating a task:

1. Read `agents/registry.json` from the current repository checkout.
2. Resolve the requested agent by its stable `id`. For capability-based routing, select an enabled agent whose `capabilities` cover the task; prefer the narrowest relevant specialist.
3. Validate that the selected entry is `enabled: true`, the target is listed in Byval's `allowedTargets`, and delegation is permitted by the host.
4. Load the referenced profile file when `profile` is non-null. If the profile is missing or unreadable, do not silently invent its instructions; report the issue and use a documented fallback only if appropriate.
5. Send the bootstrap packet below as part of the delegated task prompt or host-supported startup context.
6. Keep the task scope and permissions consistent with the registry and host policy. Host-enforced permissions take precedence; registry metadata alone cannot grant access.
7. On return, validate the worker's output against the task acceptance criteria. Byval remains accountable for integration and final reporting.

If registry access is unavailable, use the bundled agent definition only when the host makes it explicitly available, and disclose that registry-based routing could not be performed.

## Bootstrap packet

Include the following fields in the delegated prompt. Values must be grounded in the current task and registry; do not fabricate missing fields.

```yaml
registry_id: byv-agent-registry
registry_schema_version: "1.0.0"
agent_id: "<selected agent id>"
agent_name: "<registry name>"
agent_role: "<registry role>"
parent_agent_id: byval
task: "<specific bounded assignment>"
expected_output: "<deliverable and format>"
acceptance_criteria:
  - "<verifiable criterion>"
relevant_context:
  - "<files, decisions, interfaces, or constraints needed for this task>"
permission_boundary:
  source_access: "<registry declaration>"
  shell: "<registry declaration>"
  network: "<registry declaration>"
  host_policy: "Host-enforced controls remain authoritative."
delegation:
  can_delegate: false
  communication: "Return findings to Byval through the host-supported task result."
```

For workers, preserve the registry's no-delegation policy. Do not tell a worker it can message another agent directly unless the host actually provides that communication capability.

## Task handoff and results

Byval should provide workers with only the context needed for their assignment, including relevant repository instructions and interface contracts. Workers should return:

- concise outcome and key decisions;
- files changed (or files inspected for read-only tasks);
- checks run and their actual results;
- blockers, assumptions, and unresolved risks;
- any required follow-up or integration notes.

Byval must distinguish reported checks from checks independently verified. Avoid parallel ownership of the same files unless the host supports safe coordination.

## Permission semantics

- `read-only` means the agent's assignment must not modify project source. Enforce this with host permissions where available.
- `read-write` describes intended source access, not blanket approval for destructive or external operations.
- `deny` for shell means do not delegate shell execution to that agent.
- `policy-controlled` means follow the host's configured policy and approval flow; it is not an unconditional allow.
- Network access is always subject to host policy and task scope.

If the host cannot enforce a declared boundary, Byval must constrain the task operationally and disclose the limitation. Never represent prompt instructions as a security sandbox.

## Current capability boundary

This repository currently provides agent profiles, a declarative registry, and orchestration instructions. Actual runtime registry loading, capability routing, dynamic bootstrap injection, inter-agent messaging, and permission enforcement depend on the host/orchestrator and are not implemented by this document.
