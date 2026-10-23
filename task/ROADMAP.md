# Agent Registry Project — Task Roadmap

> Durable project handoff. Keep this file updated whenever a phase changes state so work can resume from the repository without relying on chat history.

## Project goal

Implement the Agent Registry lifecycle for BYV Agent: define and validate agent metadata, bootstrap agents from the registry, validate delegation, support inter-agent messaging, and later support dynamic registry updates.

## Status legend

- `DONE` — implementation and required verification are complete; merged or otherwise accepted.
- `IN PROGRESS` — implementation is underway; not yet accepted.
- `BLOCKED` — cannot proceed until a listed dependency is resolved.
- `TODO` — not started.
- `REVIEW` — implementation is available for review/verification, but not accepted yet.

## Current overall status

**Current phase: P1 — IN PROGRESS**  
**Completed phase: P0 — DONE**  
**Current working branch: `feat/p1-agent-bootstrap`**  
**Previous PR: [#2 — feat(P0): implement agent registry core validation](https://github.com/naufalelghani/byv-agent/pull/2) (merged)**

P0's validator and tests passed in the user's local Windows PowerShell checkout on 2026-10-23. PR #2 was squash-merged into `main` at commit `67700779beccc4e6beb42d6797523966cd5466ed`. P1 is now being implemented on a separate branch.

## Phases

### P0 — Agent Registry Core

**Status: DONE**

Scope:
- Add JSON Schema for `agents/registry.json`.
- Add a dependency-free Node.js validator for registry metadata and references.
- Add tests for the current registry and uniqueness.
- Document the core contract and commands.

Implemented and merged in PR #2:
- `agents/registry.schema.json`
- `scripts/validate-agent-registry.mjs`
- `tests/agent-registry.test.mjs`
- `docs/p0-agent-registry-core.md`

Verification evidence (user-run locally on Windows PowerShell):
- [x] `node scripts/validate-agent-registry.mjs` — passed; registry `byv-agent-registry`, schema `1.0.0`, 5 agents.
- [x] `node --test tests/agent-registry.test.mjs` — passed; 2 tests, 0 failures.
- [x] PR #2 reviewed for merge readiness and merged into `main`.

### P1 — Bootstrap & Agent Initialization

**Status: IN PROGRESS**

Goal: make the registry the executable source of truth for agent startup, not only documentation.

Implementation scope:
- Define a clear bootstrap CLI entry point and input contract.
- Load and validate the registry before constructing any bootstrap packet.
- Resolve agent identity and load its registered profile.
- Enforce enabled state, parent identity, and the parent's declared delegation target rules.
- Reject unknown agents, disabled agents, missing task data, and invalid registry data.
- Emit a structured bootstrap packet for the host/orchestrator to inject into a spawned agent's startup context.
- Add automated tests and usage documentation.

Boundary: the CLI prepares and validates a bootstrap packet; it does not itself spawn a Claude Code teammate or sandbox shell/network access. Actual startup-context injection and host permissions remain controlled by the host runtime.

Acceptance criteria:
- [ ] Bootstrap validates the registry and fails closed on invalid registry data.
- [ ] A known enabled agent initializes with its registered profile contents included in the bootstrap packet.
- [ ] Unknown or disabled agent IDs are rejected with actionable errors.
- [ ] Parent-to-target delegation policy is enforced.
- [ ] Automated tests cover success and failure paths.
- [ ] Bootstrap and usage documentation are updated.

### P2 — Delegation & Task Validation

**Status: TODO — depends on P1**

Goal: make delegation rules executable and ensure delegated tasks are consistent with registry permissions.

Planned work:
- Validate the requesting agent, target agent, and delegation permission.
- Enforce allowed delegation targets and enabled status.
- Validate task payload/required fields and reject unsupported requests.
- Add tests for allowed and denied delegation paths.

Acceptance criteria:
- [ ] Delegation is permitted only when registry policy allows it.
- [ ] Invalid targets, disabled agents, and malformed task payloads are rejected.
- [ ] Automated tests cover positive and negative cases.

### P3 — Inter-Agent Messaging

**Status: TODO — depends on P1 and P2**

Goal: define and implement a consistent message envelope and message handling path between agents.

Planned work:
- Specify message envelope fields, sender/recipient identity, correlation/task IDs, and payload.
- Implement message validation and routing/handling integration.
- Define error and response behavior.
- Add tests for valid, invalid, and unsupported messages.

Acceptance criteria:
- [ ] Messages follow a documented, validated envelope.
- [ ] Sender/recipient and task context are checked against registry rules.
- [ ] Automated tests cover normal and error paths.

### P4 — Dynamic Registry

**Status: TODO — depends on P0–P3**

Goal: safely support registry changes during runtime or controlled reloads.

Planned work:
- Define update/reload semantics and consistency expectations.
- Validate candidate registry state before activation.
- Ensure invalid updates do not replace the active registry.
- Define audit/logging and concurrency behavior.
- Add tests for successful reload, rejected updates, and consistency.

Acceptance criteria:
- [ ] Registry updates are validated before activation.
- [ ] Failed updates leave the last valid registry active.
- [ ] Reload/update behavior is documented and tested.

## Resume instructions for a future session

1. Read this file first: `task/ROADMAP.md`.
2. Check current branch/PR status in GitHub.
3. Do not assume a status is complete without checking its acceptance checklist and actual test results.
4. Start with the earliest phase not marked `DONE`; currently that is P1 implementation and verification.
5. Once P1 is accepted, update this file and begin P2. Record implementation links, test commands/results, blockers, and status changes here.

## Progress log

- 2026-10-23 — P0 validator/schema/tests/docs committed and verified locally; PR #2 was reviewed and squash-merged into `main` at `67700779beccc4e6beb42d6797523966cd5466ed`.
- 2026-10-23 — Created `feat/p1-agent-bootstrap` from the updated `main`; beginning P1 bootstrap CLI, policy validation, automated tests, and docs.
