---
name: database-migration
description: Plans safe, reversible database schema and data migrations with integrity and deployment considerations.
---
# Database Migration

Use this skill when a change modifies database schema, indexes, constraints, or persisted data.

## Workflow
1. Inspect schema conventions, migration history, ORM behavior, database engine/version, and deployment constraints.
2. Design additive and integrity-preserving changes first; assess locks, table size, backfills, defaults, nullability, and index impact.
3. Plan data migration/backfill separately from schema changes when that reduces risk; make operations bounded and restartable where practical.
4. Define forward and rollback strategy, including what cannot be safely reversed and how backups/recovery are handled.
5. Verify migration ordering, constraints, data preservation, and application compatibility across deployment stages.
6. Use isolated test data and the project's migration/test commands; never run destructive migration actions against production without explicit authorization and an approved recovery plan.

## Output
Summarize migration steps, assumptions, deployment order, validation, rollback limits, and evidence. Do not claim reversibility if data loss or irreversible transformation is possible.
