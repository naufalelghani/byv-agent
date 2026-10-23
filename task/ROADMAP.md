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

**Current phase: P2 — IN PROGRESS**  
**Completed phases: P0 — DONE; P1 — DONE**  
**Current P2 branch: `feat/p2-delegation-task-validation`**  
**Latest merged PR: [#3 — feat(P1): add agent bootstrap packet generation](https://github.com/naufalelghani/byv-agent/pull/3)**

P0 was merged through PR #2 at `67700779beccc4e6beb42d6797523966cd5466ed`. P1 was squash-merged through PR #3 at `9c6ae9858f5c7f4a7b2ea317961fb9ff04e9f83c`. On 2026-10-23, local Windows PowerShell verification of the P1 test suite reported 8 passed, 0 failed. P2 is now being implemented on a branch created from `main`; the P2 test suite has been added to CI but has not yet been executed or accepted.

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
- [x] PR #2 merged into `main`.

### P1 — Bootstrap & Agent Initialization

**Status: DONE**

Goal: make the registry the executable source of truth for agent startup, not only documentation.

Implemented and merged in PR #3:
- Reusable validated registry loader and validation core.
- Bootstrap CLI that resolves the registered identity/profile and emits a structured startup packet.
- Enforcement of enabled state, parent identity, and registered delegation target policy during bootstrap.
- Automated registry and bootstrap tests, CI workflow, and documentation.

Boundary: the CLI prepares a bootstrap packet; it does not itself spawn a Claude Code teammate or sandbox shell/network access. Actual startup-context injection and host permissions remain controlled by the host runtime.

Verification evidence (user-run locally on Windows PowerShell, 2026-10-23):
- [x] `node scripts/validate-agent-registry.mjs` — passed; 5 registered agents.
- [x] Manual `scripts/bootstrap-agent.mjs` run for Sam — emitted the expected JSON packet.
- [x] Unknown agent ID `not-registered` — rejected with `Unknown agent id`.
- [x] `node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs` — 8 passed, 0 failed.
- [x] PR #3 squash-merged into `main` at `9c6ae9858f5c7f4a7b2ea317961fb9ff04e9f83c`.

### P2 — Delegation & Task Validation

**Status: IN PROGRESS**

Goal: make delegation rules executable and ensure delegated tasks are consistent with registry permissions and an explicit task contract.

Implementation added on `feat/p2-delegation-task-validation`:
- `scripts/delegation-core.mjs` — shared pure validator for requester, target, registry delegation permissions, enabled state, and task payload shape.
- `scripts/validate-delegation.mjs` — CLI preflight that emits a normalized JSON delegation contract; it does not spawn agents.
- `scripts/bootstrap-agent.mjs` now reuses the shared validator instead of maintaining a separate delegation-policy implementation.
- `tests/delegation-validation.test.mjs` — positive/negative policy, malformed payload, unsupported field/option, and CLI cases.
- CI now includes the P2 test file, and documentation describes the standalone contract.

Acceptance criteria (pending actual execution on this branch):
- [ ] Delegation is permitted only when registry policy allows it.
- [ ] Unknown/disabled requester or target, disallowed targets, self-delegation, malformed task payloads, and unsupported fields/options are rejected.
- [ ] Automated tests cover positive and negative cases; run `node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs tests/delegation-validation.test.mjs`.
- [ ] GitHub Actions passes and PR is reviewed/merged.

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
2. Check the current branch and PR status in GitHub.
3. Do not assume a status is complete without checking its acceptance checklist and actual test results.
4. Continue P2 validation on `feat/p2-delegation-task-validation`; run the local test command above, inspect GitHub Actions, then open/review/merge the PR before marking P2 `DONE`.
5. Once P2 is accepted, begin P3 and keep implementation links, test commands/results, and blockers here.

## Progress log

- 2026-10-23 — P0 schema, validator, tests, and docs verified locally and merged through PR #2 at `67700779beccc4e6beb42d6797523966cd5466ed`.
- 2026-10-23 — P1 bootstrap CLI, tests, CI, and docs merged through PR #3 at `9c6ae9858f5c7f4a7b2ea317961fb9ff04e9f83c`; user confirmed 8/8 local tests passed.
- 2026-10-23 — Started P2 on `feat/p2-delegation-task-validation`: added the reusable delegation validator, standalone validation CLI, tests, CI coverage, and documentation. Verification on this branch is pending.
