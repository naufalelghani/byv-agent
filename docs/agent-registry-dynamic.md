# P4 — Dynamic Registry

**Status:** P4 — DONE; merged through [PR #6](https://github.com/naufalelghani/byv-agent/pull/6) into `main` at `288d1fda0b5eac9749e89a305a0d0388566adf7d`. No disk mutation or process-wide singleton is introduced by this phase.

## Purpose and boundaries

P4 adds an in-process registry manager that can validate and activate candidate registry snapshots safely. The manager starts from a validated registry and schema, keeps a private active snapshot, validates candidates before swapping the active reference, and retains the last valid snapshot if a reload fails.

This is an in-memory runtime component. It does not edit `agents/registry.json`, persist candidate changes across process restarts, watch files, distribute updates between separate processes, or make other consumers use the manager automatically. Runtime wiring must pass the current snapshot from `getSnapshot()` to the relevant services.

## Runtime API

```js
import { loadValidatedRegistry } from "./scripts/agent-registry-core.mjs";
import { createRegistryManager } from "./scripts/agent-registry-runtime.mjs";

const { registry, schema } = await loadValidatedRegistry();
const manager = await createRegistryManager({ initialRegistry: registry, schema });

const current = manager.getSnapshot();
// current.generation starts at 1; current.registry is a detached copy.

const candidate = structuredClone(current.registry);
candidate.description = "Updated registry description";
const next = await manager.reload(candidate, { source: "operator-request" });
// next.generation increments only after full validation succeeds.
```

Manager methods:

- `getSnapshot()`: a detached copy of the active registry with generation, activation timestamp, and SHA-256 digest.
- `reload(candidateRegistry, { source })`: validates schema version, exact fields, unique IDs, profile paths, and delegation references before activation.
- `getAuditLog()`: a detached view of the bounded audit history, including initialization, activated, unchanged, and rejected attempts.

## Safety and concurrency semantics

- Candidate data is cloned when supplied and validated before the active registry reference is swapped.
- Reload operations are serialized in call order. A failed reload does not poison the queue.
- A rejected candidate adds a bounded audit event and leaves the active registry, digest, activation time, and generation unchanged.
- A candidate with the same stable digest is recorded as `unchanged`; the generation does not advance.
- Snapshot and audit reads return copies so callers cannot mutate internal active state.
- The audit log is in memory and defaults to the latest 100 entries; configure `auditLimit` for a different positive limit.
- Audit entries record a source label but no full candidate payloads.

The validator still depends on local profile files existing beneath the repository root. This is intentional for this version: a candidate cannot activate if its referenced profile is missing or escapes the repository.

## Candidate preflight CLI

To check a proposed JSON registry file without activating it or changing the checked-in registry:

```sh
node scripts/validate-registry-candidate.mjs ./candidate-registry.json
```

Successful output includes `valid: true`, `candidateStatus: "valid_not_activated"`, the registry ID, schema version, agent count, and a stable SHA-256 digest. Invalid input returns a non-zero exit code.

## Verification

```sh
node scripts/validate-agent-registry.mjs
node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs tests/delegation-validation.test.mjs tests/agent-message.test.mjs tests/registry-runtime.test.mjs
```

Automated tests cover successful activation, validation failure preserving the last valid state, concurrent reload ordering, unchanged candidates, detached snapshots, bounded audit history, and candidate CLI behavior.


## Merge and verification record

PR [#6](https://github.com/naufalelghani/byv-agent/pull/6) was squash-merged into `main` at `288d1fda0b5eac9749e89a305a0d0388566adf7d`. GitHub Actions run [39980441173](https://github.com/naufalelghani/byv-agent/actions/runs/39980441173) and user-run Windows PowerShell verification both passed all 37 tests.
