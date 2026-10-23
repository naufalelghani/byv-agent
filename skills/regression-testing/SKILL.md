---
name: regression-testing
description: Selects and executes regression checks after changes or defect fixes to detect unintended behavior changes.
---
# Regression Testing

Verify that a change fixes the target issue without breaking existing behavior.

## Workflow
1. Identify the fix/change and the adjacent components, APIs, data flows, and user journeys it may affect.
2. Reuse existing tests and map them to changed behavior and acceptance criteria.
3. Add a regression test for a confirmed defect when practical; ensure it fails before the fix when feasible.
4. Select a risk-based regression set: focused tests first, then broader suite and critical journeys.
5. Check compatibility, persistence/state transitions, authorization, and error paths when relevant.
6. Retest after each engineering fix and record the exact commit/build tested.

## Output
Report target issue status, regression scope, exact checks and results, failures unrelated to the change, untested areas, and residual risk. A successful targeted test does not imply the entire suite passed.
