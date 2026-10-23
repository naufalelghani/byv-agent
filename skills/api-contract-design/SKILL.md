---
name: api-contract-design
description: Designs consistent, version-aware API contracts including schemas, errors, validation, and compatibility expectations.
---
# API Contract Design

Use this skill when creating or changing HTTP APIs or service boundaries.

## Workflow
1. Review existing API conventions, source requirements, consumers, and any OpenAPI/schema definitions.
2. Define routes, methods, request/response schemas, required and optional fields, types, constraints, and examples.
3. Specify authentication and authorization expectations, status codes, stable error shapes, pagination/filtering, and idempotency where relevant.
4. Consider backward compatibility, versioning, nullability, serialization, rate limits, and safe handling of sensitive fields.
5. Coordinate contract changes with consumers and identify contract, integration, and negative tests.

## Output
Document the agreed contract and compatibility notes in the project's established location. Keep examples valid and consistent with schemas. Do not silently break existing consumers or claim a contract is implemented before verification.
