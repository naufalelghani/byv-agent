---
name: task-decomposition
description: Break an approved scope into ordered, independently verifiable implementation tasks with dependencies and handoff details.
---

# Task Decomposition

Use this skill to turn requirements and architecture into an actionable implementation plan.

## Workflow

1. Split work into small, outcome-oriented tasks; avoid vague tasks such as "build backend."
2. Map each task to its owning area (backend, frontend, data, infrastructure, tests, docs) and likely modules/files only when repository evidence supports the paths.
3. Mark dependencies and identify tasks that can safely run in parallel.
4. Define task inputs, outputs, contracts, and completion checks.
5. Include migrations, error states, validation, authorization, tests, and documentation where applicable.
6. Identify integration points and sequence tasks to reduce merge conflicts.
7. Specify verification commands based on repository scripts; do not invent commands.
8. Include a final integration and acceptance pass.

## Output

For each task include:
- ID and concise title
- Goal / scope
- Dependencies
- Owner or workstream
- Expected artifacts
- Acceptance / verification checks

Keep simple requests simple. Do not create artificial subtasks or unnecessary parallel agents. Avoid assigning overlapping edits to parallel workers.
