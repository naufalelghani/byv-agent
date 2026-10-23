---
name: test-strategy
description: Defines a risk-based QA strategy, test scope, coverage priorities, and exit criteria for a software change.
---
# Test Strategy

Create a pragmatic, risk-based test strategy before testing substantial changes.

## Workflow
1. Read repository guidance, architecture, package scripts, CI configuration, and the change's requirements.
2. Identify changed components, dependencies, critical user journeys, security boundaries, and likely failure modes.
3. Select appropriate test levels: static checks, unit, integration, API, UI/E2E, accessibility, security, and regression.
4. Prioritize tests by likelihood, impact, exposure, and reversibility. Avoid broad, expensive tests when a focused check provides adequate evidence.
5. Define test data, environment assumptions, commands, expected outcomes, and clear exit criteria.
6. Record gaps and risks that cannot be tested in the available environment.

## Output
Provide scope, prioritized test matrix, test environment, prerequisites, commands, acceptance/exit criteria, and residual risks. Distinguish planned tests from executed tests. Never claim coverage or success without evidence.
