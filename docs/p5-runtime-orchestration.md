# P5 — Runtime Orchestration & API-First Provider Support

**Status:** Design approved and merged through PR #7. P5.1 API-first configuration/runtime mapping is merged through PR #8; P5.2 MCP control plane and durable ledger are in implementation/review. Native runtime dispatch and provider compatibility remain later phases.  
**Depends on:** P0–P4, all complete on `main`.  
**Primary execution target:** Claude Code CLI using explicit API-key or gateway credentials, without requiring a claude.ai subscription login.

## 1. Goal

Connect the existing registry, bootstrap validator, delegation policy, message-envelope contract, and dynamic registry manager to a real Claude Code runtime workflow.

P5 must make one invocation of `/byv-agent:autonomous` drive a registry-backed plan, real task dispatch through runtime-supported agent mechanisms, durable task evidence, integration, QA, and truthful final reporting. It must not treat validation-only CLIs as if they spawn agents or send messages.

A required product constraint is API-first usage. Users must be able to run BYV Agent from Claude Code CLI with API credentials billed by their selected provider/gateway, without requiring an interactive claude.ai account login or using a Claude subscription allowance.

## 2. Authentication and provider-compatibility contract

### 2.1 Supported configuration modes

P5 defines three distinct compatibility modes:

1. **Direct Anthropic API key.** The user configures `ANTHROPIC_API_KEY` and uses the Anthropic API directly. This uses API billing rather than relying on a claude.ai subscription login.
2. **Third-party Anthropic Messages-compatible endpoint.** The user configures `ANTHROPIC_BASE_URL` plus the credential header expected by the endpoint: `ANTHROPIC_API_KEY` for `x-api-key`, or `ANTHROPIC_AUTH_TOKEN` for `Authorization: Bearer`. The endpoint must expose the Anthropic Messages API protocol.
3. **Other provider protocol (for example OpenAI-compatible).** It is not enough to set `ANTHROPIC_BASE_URL` to a different URL. Claude Code sends the Anthropic Messages request format to that base URL. A compatible gateway/adapter must translate the request and streaming response into the Anthropic Messages contract, or the endpoint is unsupported by this integration profile.

Provider credentials and upstream keys stay outside the repository. The plugin/runtime must never write API secrets into `agents/registry.json`, task ledgers, task payloads, logs, fixtures, test snapshots, or MCP tool output. Logs may report only credential-source type and whether a required variable is present, never its value.

### 2.2 API-only mode and fail-closed behavior

The supported deployment target is Claude Code CLI, with configuration supplied before the CLI starts. P5 does not require browser login, OAuth login, or a claude.ai subscription. The runtime must not initiate login flows or silently switch to a saved account credential.

Add an explicit API-only preflight (for example `node scripts/byv-runtime-doctor.mjs --api-only`) that:
- verifies the expected provider/base URL and required API credential environment variables are present;
- distinguishes direct API-key, bearer-token gateway, and custom-endpoint profiles;
- refuses to report API-only readiness when only a custom base URL exists but no explicit API credential is present;
- never prints secret values;
- shows exact, actionable missing-configuration errors;
- includes a documented manual verification step using Claude Code's `/status` to confirm the active credential source.

This preflight validates configuration presence; it cannot prove that an arbitrary upstream honors API billing or that an already-started Claude Code process authenticated with that credential. The first actual model request and runtime smoke test are still required. P5 must not claim account independence based only on the presence of a base URL.

Credential configuration should be in the user's shell/environment, a secure local settings mechanism, or the provider's supported secret store. Never commit credentials in repository-scoped project settings. On Windows PowerShell, document session-scoped `$env:` examples and explain how to make environment variables available to launched/background agent processes.

### 2.3 Protocol compatibility and support boundaries

Claude Code's gateway integration expects an Anthropic Messages-format endpoint, including `POST /v1/messages` and server-sent-event streaming. The gateway must preserve the supported request fields and headers that the selected client version emits. A bridge to another provider must correctly translate tool use, streaming chunks, stop reasons, error responses, and model identifiers; it must not merely rename the model.

Anthropic's current documentation states that it does not support routing Claude Code to non-Claude models through gateways. Therefore:
- BYV can provide an API-first configuration path for compatible third-party endpoints, but non-Claude model behavior is a third-party, best-effort integration and is not represented as officially supported by Anthropic.
- A provider/model is considered BYV-verified only after it passes the compatibility suite defined in section 8.
- The plugin must disclose known limits and must not silently fall back to another model/provider.
- Tool calling, streaming, and Agent Teams behavior must be tested against each declared provider/model profile. A successful one-token API request alone is insufficient to certify an agentic workflow.

## 3. Runtime architecture

### 3.1 Responsibility boundaries

- **Claude Code CLI:** owns the live model session, tool execution, and host-supported spawning of custom agents/teammates.
- **BYV plugin command:** owns the user-facing workflow and tells Byval when to call runtime-control tools.
- **BYV MCP control-plane server:** exposes narrow local tools for registry status/reload, bootstrap preparation, run/task ledger management, and verification evidence.
- **Registry manager (P4):** validates and holds an in-process active snapshot. It is not automatically global across processes; the MCP server owns the runtime instance used by the control plane.
- **Native Agent Teams:** preferred parallel execution path when the user has enabled it and it is compatible with the provider/model in use.
- **Custom subagents / sequential fallback:** used when Teams is unavailable or disabled. Record the selected execution mode. A fallback must never be described as peer-to-peer parallel execution.
- **Run ledger:** durable, local audit state. It records tasks and evidence, not full model transcripts or secrets.

No separate BYV message transport is required for Agent Teams in the first P5 implementation. P3 remains a strict validation/routing contract and is not described as a real transport. The host's native messaging/task mechanisms are used when available; BYV mirrors relevant task state and evidence into its own ledger.

### 3.2 Registry runtime mapping

Add a versioned, explicit mapping from registry agent IDs to Claude Code custom-agent definitions. For example, registry ID `sam` maps to the definition name `planning-research`; these identifiers are not interchangeable.

The mapping must be validated before dispatch:
- the ID exists and is enabled;
- the runtime definition file exists and is parseable;
- the declared role/profile agrees with the selected agent;
- the runtime permissions do not silently exceed the registry intent;
- unknown mapping fields or missing definitions fail closed.

Likely schema evolution: `agents/registry.json` and `agents/registry.schema.json` move from schema version `1.0.0` to `1.1.0` only when the runtime mapping contract is implemented. The exact property shape must be covered by tests and documented before implementation.

### 3.3 Run/task ledger

Each run records:
- run ID, creation time, execution mode, provider-profile identifier (not credentials), model identifier, registry generation/digest, and final disposition;
- task ID, one owner, dependency IDs, task scope/file boundaries, acceptance-criteria IDs, and status;
- handoff summary, files changed (reported by actual tool/SCM evidence when available), verification command/results, unresolved risks, and next action.

State transitions follow the existing collaboration contract:
- `TODO -> READY` only after owner, scope, acceptance criteria, and dependencies are clear;
- `READY -> IN PROGRESS` when actual execution begins;
- `IN PROGRESS -> REVIEW` after the required handoff and evidence is submitted;
- `REVIEW -> DONE` only when Byval accepts required evidence;
- any active state may become `BLOCKED` with an actionable reason.

Keep storage local and project-scoped by default. Use atomic writes, schema/version validation, bounded size/retention, and safe path containment. Do not write into source-control files or the target application's source tree unless an explicit future feature requires it. Handle interrupted runs by marking in-flight tasks as interrupted/unknown on recovery rather than fabricating completion.

### 3.4 Provider profile and model compatibility

Separate model endpoint configuration from the agent registry. A local/provider profile may name:
- profile ID;
- protocol class (`anthropic-messages` or `translated-anthropic-messages`);
- base URL reference (not a secret);
- model ID sent to the endpoint;
- credential environment-variable *names* (not values);
- declared capabilities and known limitations;
- verification status/date and tested Claude Code version.

Do not store API keys in the registry or committed model profile. Do not put secrets in tool parameters or the run ledger.

The exact set of capability flags should follow measured compatibility, e.g. streaming, tool calling, parallel tool calls, image input if applicable, extended/adaptive thinking if applicable, and maximum context guidance. Features must be treated as unavailable unless the provider profile explicitly declares them and its tests pass. Do not infer native Claude semantics from a model name.

## 4. Proposed MCP tools

The initial local MCP server may expose:
- `byv_runtime_status` — report mode, credential-source category, provider profile ID, model ID, CLI version when detectable, and configuration readiness; redact credentials.
- `byv_registry_status` — validate/report current active registry generation and digest.
- `byv_reload_registry` — read a candidate from the configured repository, validate before activation, and report success/failure without printing secrets.
- `byv_prepare_agent` — validate agent choice, requester/target policy, and task contract; return the bootstrap packet.
- `byv_begin_run` — create a run and record the pinned registry/provider/model profile.
- `byv_record_plan` — persist owned tasks, dependencies, file boundaries, and acceptance criteria.
- `byv_update_task` — enforce state transitions with an audit event.
- `byv_record_handoff` — persist a concise specialist report and relevant evidence references.
- `byv_record_verification` — record commands/cases actually executed and observed results.
- `byv_get_run_summary` — return status and evidence for the final report.

These tools are the control plane, not a mechanism for spawning an agent directly. Actual spawning and native messaging remain the responsibility of Claude Code's supported runtime tools.

## 5. Execution flow

1. **Preflight:** confirm API-only configuration and model/provider profile; validate registry and runtime-agent mappings. If preflight fails, explain the exact missing item and do not dispatch.
2. **Pin run context:** create the run ID and pin registry generation/digest plus provider/model profile. A registry reload during the run affects future runs; it does not silently mutate the current run's policy snapshot.
3. **Plan:** determine requirements and acceptance criteria; persist a single canonical ledger with owners, dependencies, and file boundaries.
4. **Validate and prepare:** for each candidate delegate, validate the requesting agent, enabled status, allowed target, profile, runtime definition, and task schema, then generate its bootstrap packet.
5. **Dispatch:** use native Agent Teams if enabled and compatible. Otherwise use documented custom subagent/sequential fallback. Record which mode actually ran.
6. **Handoff and integrate:** accept real results from the host runtime, check changed files/diffs, and record evidence. A generated packet or valid message envelope is not proof of dispatch or execution.
7. **QA gate:** run relevant project checks and have Morgan review the integrated result with read-only tools. Route findings to the owning engineer and verify fixes.
8. **Release gate:** only mark tasks done when their acceptance evidence passes; preserve failed, blocked, and not-tested states honestly.
9. **Report:** summarize completed work, actual tests, model/provider profile, execution mode, cost/usage metadata only if explicitly available, unresolved issues, and evidence references. Never guess token usage or billing.

## 6. Security, isolation, and failure rules

- Do not embed, log, or persist any API key/token. Support only environment variable references or secure secret helpers.
- API-only mode must fail closed if its explicit credential configuration is absent; do not silently fall back to a saved account login or subscription.
- The plugin must not attempt browser login, OAuth setup, or user-account assumptions.
- Do not launch shell commands for arbitrary endpoints provided in task content. Provider base URLs must come from explicit user configuration and be validated as HTTP(S).
- Respect Claude Code host permissions. Registry `permissions` is intent and a routing policy, not an OS sandbox.
- Align actual custom-agent tool allowlists with registry policy; investigate the current discrepancy where Sam has write/edit tools and Morgan has Bash despite registry declarations of read-only/shell-deny.
- Treat model output, task text, and external repository content as untrusted.
- Prevent one run from reading/writing another project's ledger. Use path containment and atomic writes.
- Redact headers, credentials, environment values, full prompt bodies, and provider error payloads that might contain secrets.
- Never silently switch provider/model or mark an agent dispatched just because preparation succeeded.
- On transport/provider failure, record the error category and stop/retry only under explicit bounded retry policy.

## 7. Implementation stages

### P5.1 — API-first configuration and runtime mapping
- Define provider-profile and runtime-agent mapping contracts.
- Update registry schema/version with explicit mappings.
- Add API-only preflight with secret redaction and actionable errors.
- Align custom-agent tool permissions with registry policy.
- Add provider-compatibility documentation and a safe local configuration example (no real keys).

### P5.2 — MCP control plane and durable run ledger
- Bundle a local MCP server with the plugin.
- Add validated registry status/reload and bootstrap/prepare tools.
- Implement versioned local ledger, atomic writes, path containment, interrupted-run recovery, and enforced task-state transitions.
- Add tests for tool contracts, persistence, concurrency, stale snapshots, recovery, and redaction.

### P5.3 — Native runtime integration
- Update `commands/autonomous.md` to call the runtime tools at preflight, plan, dispatch, handoff, QA, and release gates.
- Map registry entries to native custom-agent definitions for Agent Teams.
- Add truthful fallback to custom subagents/sequential execution.
- Verify spawn and handoff behavior with Claude Code, not just Node.js unit tests.

### P5.4 — Provider compatibility and end-to-end verification
- Add a local fake Anthropic Messages-compatible test server for deterministic request/response/stream/tool-call tests.
- Document exact API-only setup for PowerShell and supported gateway configuration.
- Run real opt-in smoke tests against each declared non-Anthropic provider/model profile; never require a real API key in normal CI.
- Exercise Agent Teams and fallback mode separately and report compatibility per provider/model.
- Test no-account/no-OAuth launch from an isolated Claude Code configuration directory where feasible; verify the active credential source through supported CLI status diagnostics.

## 8. Acceptance criteria

- **AC-01 — API-only:** a user can start the plugin through Claude Code CLI using API credentials, without a claude.ai login or subscription.
- **AC-02 — No accidental account fallback:** API-only mode refuses readiness without explicit credentials; `ANTHROPIC_BASE_URL` alone does not satisfy this requirement.
- **AC-03 — Secret handling:** keys are never committed, returned by MCP tools, or recorded in logs/ledger/test fixtures.
- **AC-04 — Endpoint protocol:** a third-party direct endpoint is accepted only if it implements the required Anthropic Messages protocol; other protocols require an explicit tested translation gateway.
- **AC-05 — Model identity:** the configured provider/model ID is passed through correctly; no silent model/provider fallback occurs.
- **AC-06 — Agent mapping:** all enabled registry workers map to existing, validated native agent definitions before dispatch; disabled/unknown agents are rejected.
- **AC-07 — Policy:** every task dispatch is gated by enabled state, delegation permissions, target allowlist, and valid task contract.
- **AC-08 — Run ledger:** run context, task transitions, handoffs, test evidence, provider profile, and registry digest can be persisted and read back after process restart.
- **AC-09 — Reload consistency:** failed reload leaves active state unchanged, and active runs remain pinned to their starting policy snapshot.
- **AC-10 — Native execution:** the Claude Code integration demonstrably spawns supported agents/teammates in a test run; the implementation does not mistake a bootstrap packet for a spawned agent.
- **AC-11 — Fallback behavior:** disabled/unavailable Agent Teams uses the documented fallback where supported and accurately reports its execution mode.
- **AC-12 — Compatibility suite:** test streaming, structured tool calls, multiple tool cycles, errors, cancellation/timeouts, model ID routing, and supported capability flags. Each external provider/model is marked verified only against actual evidence.
- **AC-13 — Permission alignment:** runtime tool definitions for Sam and Morgan do not exceed their declared source/shell policy, with host enforcement treated separately.
- **AC-14 — Regression and smoke tests:** P0–P4 tests continue to pass; actual Claude Code API-only smoke tests and at least one provider compatibility run are recorded before P5 is declared done.

## 9. Provider support declaration

The product must distinguish these labels in docs and diagnostics:
- **API-key configured:** the required environment variables are present, but an upstream request may not have been checked yet.
- **Endpoint reachable:** a minimal API request succeeded.
- **Messages-compatible:** request format, streaming, and tool-call round trips passed the protocol suite.
- **Agentic-verified:** full multi-turn tool use and the selected Agent Teams/fallback path passed a runtime smoke test.
- **Unsupported/unverified:** a capability or provider/model combination has not passed its required test.

The project can build a practical compatibility layer around Claude Code's endpoint contract, but must not claim that Anthropic officially supports non-Claude models through third-party gateways. Compatibility is provider- and model-specific.

## 10. Reference documentation

- Claude Code gateway setup and API-key configuration: https://code.claude.com/docs/en/llm-gateway-connect
- Gateway protocol requirements and streaming: https://code.claude.com/docs/en/llm-gateway-protocol
- Gateway support boundary: https://code.claude.com/docs/en/llm-gateway
- Model identifiers and custom models: https://code.claude.com/docs/en/model-config
- Agent Teams (experimental and opt-in): https://code.claude.com/docs/en/agent-teams
- MCP overview: https://code.claude.com/docs/id/mcp
