---
name: risk-assessment
description: Identify security, reliability, data, performance, and delivery risks and propose practical mitigations.
---

# Risk Assessment

Use this skill during planning for changes with meaningful security, data, availability, compatibility, or delivery impact.

## Review areas

- Security: authentication, authorization, input validation, secrets, injection, trust boundaries, dependency exposure.
- Data: loss, corruption, migration safety, privacy, retention, backup and recovery.
- Reliability: timeouts, retries, idempotency, partial failure, concurrency, observability.
- Performance and scale: bottlenecks, resource limits, workload assumptions.
- Compatibility: existing API consumers, supported platforms, versions, and deployment constraints.
- Delivery: scope, dependency, rollout, rollback, and verification risks.

## Workflow

1. Inspect relevant code and project documentation; distinguish evidenced risks from hypothetical ones.
2. Describe each risk with its trigger, impact, likelihood, and severity.
3. Prioritize critical/high risks; do not inflate low-impact concerns.
4. Recommend a mitigation, owner/workstream, and a way to verify it.
5. Include rollback or recovery guidance for risky data/deployment changes.
6. Note residual risks and assumptions explicitly.

## Output

Provide a prioritized risk register:
- Risk and scenario
- Likelihood / impact
- Mitigation
- Verification
- Residual risk or rollback note

Never claim a security review or test has passed unless it was actually performed.
