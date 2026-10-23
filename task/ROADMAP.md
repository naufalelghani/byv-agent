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

**Current phase: P4 — REVIEW**  
**Completed phases: P0 — DONE; P1 — DONE; P2 — DONE; P3 — DONE**  
**Current P4 branch: `feat/p4-dynamic-registry`**  
**Current P4 PR: [#6 — feat(P4): add safe dynamic registry reload manager](https://github.com/naufalelghani/byv-agent/pull/6)**  
**Latest merged PR: [#5 — feat(P3): validate inter-agent message envelopes](https://github.com/naufalelghani/byv-agent/pull/5)**

P0 was merged through PR #2 at `67700779beccc4e6beb42d6797523966cd5466ed`. P1 was squash-merged through PR #3 at `9c6ae9858f5c7f4a7b2ea317961fb9ff04e9f83c`. On 2026-10-23, local Windows PowerShell verification of the P1 test suite reported 8 passed, 0 failed. P2 was squash-merged through PR #4 into `main` at `dbd14a22c3d5a1526af1628f807b4d3baec98181`. GitHub Actions run [39977192665](https://github.com/naufalelghani/byv-agent/actions/runs/39977192665) passed registry validation and all 18 tests. The user also verified the same 18 tests locally on Windows PowerShell, with 0 failures. P3 was squash-merged through PR #5 into `main` at `dffd293f33a06a769303aef46f3d323dfa3c1594`. GitHub Actions run [39979200629](https://github.com/naufalelghani/byv-agent/actions/runs/39979200629) passed all 29 tests, and the user verified the same 29 tests passed locally on Windows PowerShell. P3 validates message envelopes and prepares a delivery plan; actual message dispatch and task-state persistence are not included. P4 implementation is underway on `feat/p4-dynamic-registry`: it adds a process-local manager for validated, serialized reloads, preserves active state on failures, records bounded audit events, and adds a candidate preflight CLI.

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

**Status: DONE**

Goal: make delegation rules executable and ensure delegated tasks are consistent with registry permissions and an explicit task contract.

Implementation added on `feat/p2-delegation-task-validation`:
- `scripts/delegation-core.mjs` — shared pure validator for requester, target, registry delegation permissions, enabled state, and task payload shape.
- `scripts/validate-delegation.mjs` — CLI preflight that emits a normalized JSON delegation contract; it does not spawn agents.
- `scripts/bootstrap-agent.mjs` now reuses the shared validator instead of maintaining a separate delegation-policy implementation.
- `tests/delegation-validation.test.mjs` — positive/negative policy, malformed payload, unsupported field/option, and CLI cases.
- CI now includes the P2 test file, and documentation describes the standalone contract.

Acceptance criteria:
- [x] Delegation is permitted only when registry policy allows it.
- [x] Unknown/disabled requester or target, disallowed targets, malformed task payloads, and unsupported fields/options are rejected.
- [x] Automated tests cover positive and negative cases — GitHub Actions run [39977192665](https://github.com/naufalelghani/byv-agent/actions/runs/39977192665): 18 passed, 0 failed.
- [x] User-run Windows PowerShell verification: 18 passed, 0 failed.
- [x] PR #4 squash-merged into `main` at `dbd14a22c3d5a1526af1628f807b4d3baec98181`.

### P3 — Inter-Agent Messaging

**Status: DONE**

Goal: define and implement a consistent message envelope and message handling path between agents.

Implemented on `feat/p3-inter-agent-messaging`:
- `scripts/agent-message-core.mjs` — validates envelope version, IDs, ISO-8601 timestamps, type-specific payloads, enabled sender/recipient, and delegation policy for task messages. Returns a normalized message and a `validated_not_dispatched` delivery plan.
- `scripts/validate-agent-message.mjs` — CLI reads a JSON envelope file and emits the normalized message/delivery plan; it does not dispatch messages.
- `tests/agent-message.test.mjs` — valid task/reply messages, unknown/disabled identities, policy violations, malformed IDs/timestamps/payloads, unsupported fields/types, and CLI error/success paths.
- `docs/agent-registry-messaging.md` — documents the message envelope and explicit runtime boundary.
- `.github/workflows/agent-registry.yml` now runs P3 messaging tests.

Runtime boundary: there is no message transport or task ledger yet. Correlation IDs and acknowledgements are format-validated; they cannot be checked against persisted prior messages.

Acceptance criteria:
- [x] Messages follow a documented, strict versioned envelope with type-specific payloads.
- [x] Enabled sender/recipient identities are checked against registry; new task messages reuse delegation policy.
- [x] Automated tests cover normal and error paths — GitHub Actions run [39979200629](https://github.com/naufalelghani/byv-agent/actions/runs/39979200629): 29 passed, 0 failed.
- [x] User-run Windows PowerShell verification: 29 passed, 0 failed.
- [x] PR #5 squash-merged into `main` at `dffd293f33a06a769303aef46f3d323dfa3c1594`.

### P4 — Dynamic Registry

**Status: REVIEW — GitHub Actions passed; PR #6 remains open**

Goal: safely support registry changes during runtime or controlled reloads.

Implemented on `feat/p4-dynamic-registry`:
- `scripts/agent-registry-runtime.mjs` — process-local manager with detached snapshots, SHA-256 digest, generation counter, serialized reloads, candidate validation before activation, no-op detection, and bounded audit events.
- `scripts/validate-registry-candidate.mjs` — preflight CLI validates a candidate registry without activating it or editing `agents/registry.json`.
- `tests/registry-runtime.test.mjs` — reload success/failure, preservation of the last valid state, concurrency ordering, no-op behavior, audit bounds, detached snapshots, and CLI behavior.
- `docs/agent-registry-dynamic.md` — documents API, transactional semantics, and runtime boundaries.
- CI includes P4 tests.

Acceptance criteria (CI passed; merge pending):
- [x] Candidate registry is validated fully before activation.
- [x] Failed updates leave the last valid in-memory registry, generation, digest, and activation timestamp unchanged.
- [x] Reload calls are serialized; unchanged candidates do not advance generation.
- [x] Reload behavior and runtime boundaries are documented; positive and negative cases have automated tests.
- [x] GitHub Actions run [39980353273](https://github.com/naufalelghani/byv-agent/actions/runs/39980353273) passed all 37 tests (37 passed, 0 failed).
- [ ] PR #6 is reviewed and merged.

## Resume instructions for a future session

1. Read this file first: `task/ROADMAP.md`.
2. Check the current branch and PR status in GitHub.
3. Do not assume a status is complete without checking its acceptance checklist and actual test results.
4. Complete local/CI verification and review PR for P4 — Dynamic Registry before marking P4 DONE.

## Progress log

- 2026-10-23 — P0 schema, validator, tests, and docs verified locally and merged through PR #2 at `67700779beccc4e6beb42d6797523966cd5466ed`.
- 2026-10-23 — P1 bootstrap CLI, tests, CI, and docs merged through PR #3 at `9c6ae9858f5c7f4a7b2ea317961fb9ff04e9f83c`; user confirmed 8/8 local tests passed.
- 2026-10-23 — P2 delegation/task validator, CLI, tests, CI, and docs passed user local verification (18/18) and GitHub Actions run [39977192665](https://github.com/naufalelghani/byv-agent/actions/runs/39977192665). PR #4 was squash-merged into `main` at `dbd14a22c3d5a1526af1628f807b4d3baec98181`; P2 marked DONE.

- 2026-10-23 — Started P3 on `feat/p3-inter-agent-messaging`: added versioned message-envelope validation, type-specific payload validation, registry identity and task-delegation checks, a CLI validation/delivery-plan step, tests, CI coverage, and documentation. Actual transport and task-state persistence remain out of scope.

- 2026-10-23 — P3 CI passed on PR #5: GitHub Actions run [39979012365](https://github.com/naufalelghani/byv-agent/actions/runs/39979012365), 29 tests passed, 0 failed. P3 state moved to REVIEW pending merge approval.

- 2026-10-23 — P3 merged through PR #5 at `dffd293f33a06a769303aef46f3d323dfa3c1594`; GitHub Actions and user-run Windows PowerShell both reported 29 passed, 0 failed. P3 marked DONE.

- 2026-10-23 — Started P4 on `feat/p4-dynamic-registry`: created a process-local transactional registry manager, candidate validation CLI, runtime tests, CI coverage, and documentation. Runtime changes are in memory only; candidate preflight does not modify the checked-in registry.

- 2026-10-23 — P4 implementation opened as PR #6. GitHub Actions run [39980353273](https://github.com/naufalelghani/byv-agent/actions/runs/39980353273) passed registry validation and all 37 tests (37 passed, 0 failed); P4 moved to REVIEW pending merge.
