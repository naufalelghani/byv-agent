---
name: test-automation
description: Implements and runs maintainable automated checks using the test framework and conventions already present in the repository.
---
# Test Automation

Automate repeatable checks while respecting the project's existing stack and conventions.

## Workflow
1. Inspect manifests, scripts, test configuration, fixtures, and CI before choosing tools.
2. Prefer existing dependencies and established patterns; do not add a framework without explaining the value and approval when needed.
3. Keep tests deterministic, isolated, readable, and focused on externally observable behavior.
4. Use appropriate layers: unit for logic, integration for component boundaries, API for contracts, and browser E2E for critical user journeys.
5. Avoid real production services, secrets, destructive data operations, and flaky timing assumptions. Mock only boundaries, not the behavior under test.
6. Run the narrow relevant tests first, then broader checks when feasible. Report exact commands and results.

## Output
Include test files changed, commands executed, pass/fail counts, relevant logs, skipped checks, and environment limitations. Never fabricate execution evidence.
