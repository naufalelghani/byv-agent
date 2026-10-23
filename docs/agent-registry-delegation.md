# P2 — Delegation & Task Validation

**Status:** P2 — DONE; merged through PR #4  
**Source of truth:** `agents/registry.json`

## Purpose and boundary

Validate a proposed delegation against registry policy before work is scheduled. The validator checks requester and target identity, enabled state, delegation permission, allowed targets, and a strict task payload. It returns a normalized JSON contract and does not spawn an agent, inject startup context, route messages, or enforce operating-system permissions. Host controls remain authoritative.

## Command-line preflight

From the repository root:

```sh
node scripts/validate-delegation.mjs \
  --requester byval \
  --target sam \
  --task "Research authentication options" \
  --expected-output "A Markdown comparison" \
  --acceptance "The comparison cites repository evidence" \
  --context "README.md"
```

Repeat `--acceptance` for additional criteria and `--context` for additional context entries. Run `node scripts/validate-delegation.mjs --help` for usage.

The command fails with a non-zero exit status when arguments are missing, an option is unsupported, the registry is invalid, the requester/target is unknown or disabled, the requester cannot delegate, the target is not allowed, or the task payload is malformed.

## Request contract

The shared function `validateDelegationRequest({ registry, request })` accepts a request with exactly these top-level keys:

- `requestingAgentId`: non-empty ID of the agent requesting delegation.
- `targetAgentId`: non-empty ID of the selected target.
- `taskPayload`: task details with required `description`, `expectedOutput`, and a non-empty `acceptanceCriteria` array. Optional `relevantContext` must be an array of non-empty strings when supplied.

Unknown top-level or task payload fields are rejected rather than silently ignored. String values are trimmed for the returned contract. Missing task context defaults to an empty array.

## Policy checks

The validator rejects the request when:
- the requester or target does not exist in the checked registry;
- either agent is disabled;
- the requester attempts to delegate to itself;
- the requester does not have `delegation.canDelegate: true`;
- the target is absent from the requester's `delegation.allowedTargets`;
- task description/output is empty, acceptance criteria are absent/empty, or an unsupported field is included.

Both the standalone CLI and `scripts/bootstrap-agent.mjs` use the same delegation validator, avoiding divergent policy checks.

## Verification

Run the full relevant suite:

```sh
node scripts/validate-agent-registry.mjs
node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs tests/delegation-validation.test.mjs
```

GitHub Actions run [39977192665](https://github.com/naufalelghani/byv-agent/actions/runs/39977192665) passed registry validation and all 18 tests. The user also verified 18 passed, 0 failed locally on Windows PowerShell. PR #4 was squash-merged into `main` at `dbd14a22c3d5a1526af1628f807b4d3baec98181`.
