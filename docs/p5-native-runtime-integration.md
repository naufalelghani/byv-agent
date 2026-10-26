# P5.3 — Native Runtime Integration Workflow

**Status:** Implementation/review on branch feat/p5-3-native-runtime-integration; real Claude Code dispatch smoke testing is still required.  
**Depends on:** P5.2 MCP control plane and ledger (PR #9 plus stacked hardening PR #10).

## Scope

The P5.3 workflow connects /byv-agent:autonomous to the existing control-plane tools at preflight, planning, task dispatch, handoff, QA, recovery, and release gates. It chooses among runtime-supported Agent Teams, custom subagents, and sequential execution, and keeps the ledger aligned with observed evidence.

This is workflow integration, not a new agent-spawning transport. Claude Code owns actual team/subagent invocation and host permissions. The MCP server validates startup context and persists evidence; it does not invoke a worker, run a submitted verification command, or independently attest to caller-reported results.

## Required tool sequence

1. Call **byv_runtime_status** and **byv_registry_status**. Do not start a run or dispatch workers unless API-only preflight passes and the active registry snapshot is valid.
2. Select an execution mode based on the tools/features actually available in the live host. Record it with **byv_begin_run**; selection alone is not proof of dispatch.
3. Persist one canonical plan with **byv_record_plan**. Assign each task to one enabled registry agent and define dependencies, repository-relative file boundaries, and unique acceptance criteria.
4. Transition ready work through the ledger's valid states. For a worker, call **byv_prepare_agent** against the run's pinned registry, pass its returned profile/startup context into the host-supported invocation, and confirm that the host actually started the worker. Record a dispatch failure as a blocker.
5. Persist a concise **byv_record_handoff** and a **byv_record_verification** for every acceptance criterion. The command/case and outcome must reflect what happened; set executed to false with NOT_TESTED or BLOCKED when it did not run.
6. Only transition IN_PROGRESS → REVIEW with current-attempt handoff and verification evidence. Byval decides whether REVIEW → DONE is justified. Rework starts a fresh attempt and needs fresh evidence.
7. Ask Morgan to audit the integrated diff and evidence using read-only access. A separately authorized runner executes project checks. Finish with **byv_finish_run** and reconcile **byv_get_run_summary** against the final report.

The complete operational contract, state rules, and fallback behavior live in commands/autonomous.md.

## Runtime fallback

- **Agent Teams:** use only when enabled, supported by this Claude Code runtime, and actually invoked. Do not infer availability from a setting alone.
- **Custom subagents:** use the host's supported custom-agent mechanism when Teams is unavailable and that mechanism is exposed.
- **Sequential:** use when a supported parallel mechanism is unavailable. Do not describe this as parallel execution.
- If a chosen path cannot dispatch, record the task as blocked or select a supported fallback transparently. The ledger's executionMode is the mode selected when the run starts; report later deviations and observed dispatch separately in handoff evidence and the final summary.

Do not send secrets, complete transcripts, or unbounded raw logs to the ledger. Its redaction is best-effort. Do not mark acceptance criteria PASS from code inspection alone when execution is required.

## Verification

### Automated contract regression

The new tests/byv-autonomous-workflow.test.mjs checks that the slash-command contract retains the required control-plane operations, their key ordering, and the distinction between prepared context and real dispatch. CI runs it with the registry and control-plane suite. This is a static workflow-contract test; it does not emulate Claude Code, spawn an agent, or prove MCP discovery.

### Required manual smoke test

Run in a disposable test project with an explicitly configured API credential/gateway; never copy credentials into the repo.

1. Start the plugin from the repo using the normal Claude Code plugin development/install flow, then use /mcp to confirm the byv-control-plane server starts and the expected tools are exposed.
2. Run **byv_runtime_status** and **byv_registry_status**; confirm secrets are absent from output and preflight/registry state is accurate.
3. Invoke /byv-agent:autonomous on a small, reversible change in the disposable project. Inspect the host event/tool evidence to confirm whether Agent Teams or a custom subagent actually started; otherwise verify the sequential fallback.
4. Confirm the run appears under .byv-agent/runs/, the run pins registry/provider/model metadata without credential values, task states follow legal transitions, and every PASS references an actually executed command/case.
5. Stop/restart a disposable run with a task in progress and inspect recovery behavior. Do not treat an interrupted task's prior evidence as current-attempt proof.

### What automated tests do not prove

Until the manual smoke is recorded, P5.3 is not fully accepted. A green Node.js suite validates the command contract and ledger behavior; it does not prove the installed Claude Code version discovers the MCP server, that a real agent spawned, that Agent Teams works with a given model, or that a provider is agentic-compatible. Provider/model protocol tests remain P5.4.

## Acceptance checklist

- [x] Autonomous workflow documents preflight, plan persistence, agent preparation, truthful dispatch, handoff, verification, QA, recovery, and release gates.
- [x] Static tests prevent accidental removal of critical tool calls or the dispatch/evidence boundary.
- [ ] GitHub Actions passes on the P5.3 head.
- [ ] Claude Code /mcp confirms the server and tools load.
- [ ] A disposable runtime smoke proves actual dispatch or an accurately reported fallback, and the durable ledger matches observed outcomes.
- [ ] Morgan's read-only QA behavior and the selected fallback path are verified in the host runtime.

