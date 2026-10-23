---
name: bug-investigation
description: Reproduces defects, gathers evidence, isolates likely root causes, and produces actionable bug reports without concealing uncertainty.
---
# Bug Investigation

Investigate defects systematically and preserve evidence.

## Workflow
1. Capture the reported behavior, expected behavior, environment, version, and steps to reproduce.
2. Reproduce with the smallest safe deterministic case; record whether reproduction succeeded.
3. Inspect logs, stack traces, relevant code paths, recent changes, and state/data assumptions.
4. Narrow the cause using controlled experiments. Separate confirmed cause from hypotheses.
5. Assess impact, scope, severity, and possible workarounds.
6. Do not modify application source when acting as an independent QA auditor unless explicitly delegated.

## Report
Include title, severity, environment, prerequisites, reproduction steps, expected vs actual result, evidence, impact, likely cause (with confidence), and recommended next action. Avoid exposing secrets or personal data in logs.
