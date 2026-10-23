# Agent Registry Bootstrap Contract

**Status:** P1 — implemented; P2 adds a shared delegation/task validator. Host startup injection remains runtime-dependent  
**Registry:** `agents/registry.json`

## Purpose

The registry is the canonical catalog for agent identity, role, capabilities, profile path, delegation policy, and declared permissions. A registry entry is metadata; it is not an agent runtime, permission enforcement mechanism, or communication transport.

The bootstrap helper now validates the registry and resolves a requested identity into a structured startup packet. It prepares the context for a host to inject, but it does not automatically spawn a Claude Code teammate or apply operating-system security controls.

## Run the bootstrap helper

From the repository root with Node.js installed, validate the current registry:

```sh
node scripts/validate-agent-registry.mjs
```

To prepare a packet for Sam delegated by Byval:

```sh
node scripts/bootstrap-agent.mjs \
  --agent sam \
  --parent byval \
  --task "Research the authentication options used by this project" \
  --expected-output "A concise Markdown comparison with trade-offs" \
  --acceptance "Recommendations are grounded in repository evidence" \
  --context "README.md"
```

The command writes JSON to stdout. The packet contains the registry version, canonical agent identity, task/acceptance criteria, declared permissions, delegation data, and the full registered profile contents when the profile path is non-null. Repeat `--acceptance` or `--context` to add more entries. Run `node scripts/bootstrap-agent.mjs --help` for the argument contract.

For the root orchestrator, omit `--parent` and select an enabled agent whose type is `orchestrator`. Workers require a parent ID.

## Bootstrap validation

Before producing any packet, the helper loads and validates the registry and verifies referenced profile paths. It rejects malformed registry data, unknown or disabled agents, disabled or unknown parents, parents that cannot delegate, targets not listed in the parent's `allowedTargets`, incomplete task descriptions, and missing registered profiles.

A successful packet means metadata and delegation checks passed for this repository snapshot. It is not proof that the host runtime can spawn the target, inject context, route messages, or enforce permissions.

## Bootstrap procedure

Before delegating a task:

1. Read and validate `agents/registry.json` using `node scripts/validate-agent-registry.mjs`.
2. Select an enabled agent by its stable ID. For capability-based routing, choose an enabled agent whose `capabilities` cover the task and prefer the narrowest relevant specialist.
3. Run `scripts/bootstrap-agent.mjs` with the target, parent, bounded task, expected output, acceptance criteria, and relevant context.
4. If validation or packet generation fails, do not spawn the target; surface the actionable error and repair the registry/task input first.
5. Pass the emitted packet, including `profile.content`, into the actual host-supported startup context. Do not claim the helper performed the spawn.
6. Keep the task scope and permissions consistent with the registry and host policy. Host-enforced permissions take precedence; registry metadata alone cannot grant access.
7. On return, validate worker output against the task acceptance criteria. Byval remains accountable for integration and final reporting.

If registry access is unavailable, use the bundled agent definition only when the host makes it explicitly available, and disclose that registry-based routing could not be performed.

## Bootstrap packet fields

The JSON packet includes the following sections:

- `registry`: registry ID and schema version.
- `agent`: canonical ID, name, role, type, description, and capabilities.
- `parentAgentId`: the parent authorized by the registry's delegation policy, or `null` for a root orchestrator.
- `task`: specific assignment, expected output, verifiable acceptance criteria, and relevant context.
- `profile`: registered profile path and loaded profile contents, or `null` if no profile is registered.
- `permissions`: declared source, shell, and network access, plus a reminder that host policy remains authoritative.
- `delegation`: the selected agent's own delegation declaration.
- `runtimeBoundary`: an explicit statement of what this helper does not enforce.

## Permission semantics

- `read-only` means the agent's assignment must not modify project source. Enforce this with host permissions where available.
- `read-write` describes intended source access, not blanket approval for destructive or external operations.
- `deny` for shell means do not delegate shell execution to that agent.
- `policy-controlled` means follow the host's configured policy and approval flow; it is not an unconditional allow.
- Network access is always subject to host policy and task scope.

If the host cannot enforce a declared boundary, Byval must constrain the task operationally and disclose the limitation. Never represent prompt instructions as a security sandbox.

## Current capability boundary

P1 provides local registry validation, agent/profile resolution, delegation-policy checks, and JSON startup packet generation. Actual runtime spawning, automatic startup-context injection, inter-agent messaging, dynamic registry reload, and host-enforced permission boundaries are not implemented by this document or helper; they depend on host/orchestrator capabilities and future project phases.

## Shared delegation/task validation (P2)

For a standalone policy check before scheduling work, run:

```sh
node scripts/validate-delegation.mjs \
  --requester byval \
  --target sam \
  --task "Research the authentication options used by this project" \
  --expected-output "A concise Markdown comparison with trade-offs" \
  --acceptance "Recommendations are grounded in repository evidence" \
  --context "README.md"
```

The validator accepts only the documented request fields and task payload fields. It checks that the requester and target exist and are enabled, that the requester may delegate to the selected target, and that the task has a non-empty description, expected output, and at least one non-empty acceptance criterion. Unknown command-line options and unsupported payload fields are rejected.

The standalone command returns a normalized delegation contract as JSON; it does not spawn an agent. `scripts/bootstrap-agent.mjs` reuses the same policy validator to avoid divergent delegation rules.
