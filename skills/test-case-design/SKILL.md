---
name: test-case-design
description: Converts requirements and acceptance criteria into clear, traceable positive, negative, boundary, and state-based test cases.
---
# Test Case Design

Derive tests from requirements, observable behavior, and acceptance criteria—not implementation assumptions alone.

## Workflow
1. Extract requirements and assign stable IDs where useful.
2. Map each requirement to one or more observable checks.
3. Include happy paths, invalid inputs, boundaries, missing/unauthorized data, error handling, state transitions, and relevant concurrency or retry behavior.
4. Include security and accessibility cases when the feature touches those concerns.
5. Keep cases deterministic, isolated, and reproducible; specify setup, action, expected result, and cleanup.
6. Identify ambiguity or untestable criteria and state assumptions explicitly.

## Output
Use a compact test-case table with ID, requirement, priority, preconditions, steps/input, expected result, and execution status. Do not mark a case passed until it has been executed.
