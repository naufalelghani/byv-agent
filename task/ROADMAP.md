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

**Current phase: P0 — REVIEW**  
**Next phase: P1 — TODO (blocked on P0 acceptance)**  
**Current working branch: `feat/p0-agent-registry-core`**  
**Related PR: [#2 — feat(P0): implement agent registry core validation](https://github.com/naufalelghani/byv-agent/pull/2)**

P0 files are committed on the PR branch. The two verification commands have now been run successfully in the user's local Windows PowerShell checkout on 2026-10-23. Keep P0 in `REVIEW` until PR #2 is reviewed and merged or explicitly accepted.

## Phases

### P0 — Agent Registry Core

**Status: REVIEW**

Scope:
- Add JSON Schema for `agents/registry.json`.
- Add a dependency-free Node.js validator for registry metadata and references.
- Add tests for the current registry and uniqueness.
- Document the core contract and commands.

Implemented on PR #2:
- `agents/registry.schema.json`
- `scripts/validate-agent-registry.mjs`
- `tests/agent-registry.test.mjs`
- `docs/p0-agent-registry-core.md`

Acceptance / resume checklist:
- [x] From repository root, run `node scripts/validate-agent-registry.mjs` — passed; registry `byv-agent-registry`, schema `1.0.0`, 5 agents.
- [x] Run `node --test tests/agent-registry.test.mjs` — passed; 2 tests, 0 failures.
- [x] Review any failures and fix them on the P0 branch — no failures reported by the local run.
- [ ] Review and merge/accept PR #2.
- [ ] Change status to `DONE` only after successful verification and acceptance.

### P1 — Bootstrap & Agent Initialization

**Status: TODO — blocked on P0 acceptance**

Goal: make the registry the executable source of truth for agent startup, not only documentation.

Planned work:
- Define a clear bootstrap entry point and input contract.
- Load and validate the registry before agent initialization.
- Resolve agent identity and profile from registry metadata.
- Enforce enabled/disabled state and declared configuration at bootstrap.
- Add tests for successful initialization and invalid/missing agent cases.
- Document how to launch an agent through the bootstrap flow.

Acceptance criteria:
- [ ] Bootstrap reads the registry and fails closed on invalid registry data.
- [ ] A known enabled agent initializes using its registered profile.
- [ ] Unknown or disabled agent IDs are rejected with actionable errors.
- [ ] Automated tests cover success and failure paths.
- [ ] Usage documentation is updated.

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
2. Check the PR linked above and the current branch/status in GitHub.
3. Do not assume a status is complete without checking its acceptance checklist and CI/test results.
4. Start with the earliest phase not marked `DONE`; currently that is P0 PR review/acceptance.
5. Once P0 is accepted, update this file and begin P1. Record implementation links, test commands/results, blockers, and status changes here.

## Progress log

- 2026-10-23 — P0 validator/schema/tests/docs committed to `feat/p0-agent-registry-core`; PR #2 opened as draft. Tests were initially not executable in the authoring environment due to GitHub clone/network resolution failure. Added this durable roadmap and handoff in `task/ROADMAP.md`.
- 2026-10-23 — User ran `node scripts/validate-agent-registry.mjs` successfully (registry valid, 5 agents) and `node --test tests/agent-registry.test.mjs` successfully (2 passed, 0 failed) from a local Windows PowerShell checkout. P0 remains `REVIEW` pending PR review/acceptance.
