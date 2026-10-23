# P5.2 — MCP Control Plane and Durable Run Ledger

**Status:** Implementation on review branch `feat/p5-2-mcp-control-plane-ledger`.  
**Scope:** Local MCP tools and a project-scoped, versioned task ledger. This phase does not spawn agents.

## What is added

- `.mcp.json` registers the bundled stdio MCP server with Claude Code using `${CLAUDE_PLUGIN_ROOT}`; no npm package or network service is required for the control plane.
- MCP `initialize` negotiates the protocol version supported by this server instead of blindly echoing an unsupported client version.
- `scripts/byv-mcp-server.mjs` implements JSON-RPC initialization, `tools/list`, and `tools/call` over newline-delimited stdio. Stdout is reserved for protocol messages; diagnostic output is written to stderr.
- `scripts/byv-run-ledger-core.mjs` stores versioned run snapshots as JSON in `.byv-agent/runs/` under the active project directory. Files are ignored by Git.
- Each run pins the validated registry snapshot, its generation/digest, provider-profile ID, endpoint host, protocol, model ID, selected execution-mode label, and a credential-source category. The ledger never stores API-key/token values.
- Ledger writes use an exclusive lock and atomic temporary-file rename. Aged locks are reclaimed only after the recorded owner PID is confirmed dead, with reapers serialized to avoid unlinking a replacement lock. If ownership cannot be verified, the ledger fails closed; inspect/remove stale lock artifacts only after stopping all ledger processes. Storage and task file-boundary paths are checked for containment; symlinked ledger directories are rejected. Run records, task counts, event history, field lengths, and retention are bounded.
- On control-plane startup, an active run left by a prior process is marked `interrupted`; tasks that were `IN_PROGRESS` become `BLOCKED` with an explicit unknown-outcome reason and their attempt counter advances. Existing handoff/verification remains in history but cannot satisfy completion gates for the new attempt. Resume is explicit and never fabricates a successful result.
- Task-state transitions and completion gates are enforced. A task cannot become `DONE` unless it has a handoff plus a latest, actually-executed `PASS` result for every acceptance criterion.

## MCP tools

| Tool | Purpose |
|---|---|
| `byv_runtime_status` | API-only environment preflight with secret values redacted |
| `byv_registry_status` | Report active validated registry generation, digest, and agent IDs |
| `byv_reload_registry` | Validate and activate a changed registry candidate; retain the previous snapshot on failure |
| `byv_prepare_agent` | Validate a registry-backed bootstrap packet, optionally using a run's pinned registry |
| `byv_begin_run` | Start a persistent run after API-only preflight passes |
| `byv_record_plan` | Persist a single canonical plan with owners, dependencies, file boundaries, and criteria |
| `byv_update_task` | Enforce allowed task transitions and evidence gates |
| `byv_record_handoff` | Persist a concise handoff and evidence references |
| `byv_record_verification` | Record observed command/case outcomes for acceptance criteria |
| `byv_finish_run` | Set a run disposition to `DONE`, `BLOCKED`, or `FAILED` |
| `byv_resume_run` | Explicitly resume an interrupted run after review |
| `byv_get_run_summary` | Retrieve a durable, redacted summary and audit trail |

The MCP server is a control plane, not an agent transport. `byv_prepare_agent` returns startup context only; it is not proof that a teammate was spawned. The `executionMode` field records the mode selected by the orchestrator, not an independently verified dispatch. Native Agent Teams, custom subagent invocation, and end-to-end dispatch evidence are P5.3.

## Task ledger contract

- One run has one plan. Replacing an existing plan is rejected.
- Task IDs and acceptance-criterion IDs must be unique within their respective scopes. Dependencies must exist and be acyclic.
- Owners must be enabled agents in the registry snapshot pinned to the run.
- `TODO -> READY` requires dependencies to be `DONE`; `READY -> IN_PROGRESS` records task start; `IN_PROGRESS -> REVIEW` requires a handoff and verification evidence from the current task attempt; `REVIEW -> DONE` requires a current-attempt handoff and an executed `PASS` for every criterion from that same attempt.
- `REVIEW -> IN_PROGRESS` starts a new attempt. Recovery of a run with an `IN_PROGRESS` task likewise advances that task's attempt before marking it `BLOCKED`. Earlier verification results remain tagged with their original attempt and do not satisfy the new attempt's completion gates; the previous handoff remains visible until replaced by a fresh handoff.
- After recovery and explicit resume, a task must be re-evaluated and re-executed. A current-attempt handoff and executed `PASS` verification are required before it can enter `REVIEW` and then `DONE`.
- Any non-terminal task may become `BLOCKED` with a reason. `BLOCKED -> READY` is allowed only after dependencies are complete.
- Verification records require a command, outcome, and explicit `executed` flag. The server records caller-reported evidence; it does not execute the submitted command and does not independently attest to the truth of model-authored claims.
- Handoff and verification inputs are length-limited; common token patterns and quoted or unquoted secret-like key-value fields (including JSON fields) are redacted before persistence. Redaction is best-effort, not a guarantee that arbitrary secrets or transcripts are safe to submit. Do not send raw transcripts, full command output, secrets, or credentials to MCP tools.

## Local storage and configuration

By default, ledger files are kept in the current project working directory under:

```text
.byv-agent/runs/run-<time>-<random>.json
```

Set `BYV_PROJECT_ROOT` before starting Claude Code if the MCP process does not inherit the intended project directory. The value must refer to an existing project directory; ledger storage is confined below it. `BYV_PLUGIN_ROOT` is injected from the plugin's `${CLAUDE_PLUGIN_ROOT}` entry in `.mcp.json`.

The API-only preflight still reads the environment inherited by the MCP process. It does not contact the endpoint, validate billing, or prove the active Claude Code credential source. Use `/status` in Claude Code and run a real request separately.

## Tests

From the repository root with Node.js 22:

```powershell
node scripts/validate-agent-registry.mjs
node scripts/validate-provider-profiles.mjs
node --test tests/agent-registry.test.mjs tests/agent-bootstrap.test.mjs tests/delegation-validation.test.mjs tests/agent-message.test.mjs tests/registry-runtime.test.mjs tests/provider-runtime.test.mjs tests/byv-control-plane.test.mjs
```

The tests use temporary directories and fake credentials. They do not contact a real model endpoint. Integration checks against the user's live 9Router endpoint and proof of native agent dispatch remain separate runtime verification tasks.

## Security boundaries

- No secret values are persisted in the run ledger or emitted by runtime status.
- Registry metadata is pinned in the ledger so reloads do not silently alter an in-flight run's policy snapshot.
- The ledger is local operational state, not a source-controlled artifact or a sandbox. Host permissions continue to be authoritative.
- Tool output is limited to status, structured task evidence, summaries, and agent bootstrap context; raw model transcripts are not captured.
