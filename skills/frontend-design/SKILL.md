---
name: frontend-design
description: Create distinctive, polished, production-ready interfaces with deliberate visual hierarchy and responsive behavior. Use for UI implementation or significant UI redesign.
---

# Frontend Design

Before coding, understand the product purpose, target users, existing stack, brand constraints, and current design system. Inspect the actual project rather than assuming a framework or replacing its architecture.

## Design process
- Define the primary user task and the hierarchy that makes it easy to complete.
- Choose a coherent visual direction appropriate to the product; avoid generic template-like layouts and arbitrary decoration.
- Establish a small set of reusable tokens for color, spacing, typography, radius, borders, and elevation.
- Use typography intentionally: readable body text, clear heading scale, restrained weights, and sensible line lengths.
- Build a clear composition with purposeful whitespace, alignment, and responsive adaptation.
- Use meaningful visual assets and icons. Do not use emoji as a substitute for interface icons. Do not fabricate product logos, testimonials, metrics, or content.
- Make interactions feel complete: hover/focus/active states, keyboard navigation, loading, empty, success, and error states.
- Respect reduced-motion preferences. Animation should communicate state or add subtle polish, not obstruct use.
- Ensure accessible contrast, semantic structure, labels, focus visibility, and touch target sizing.

## Implementation rules
- Reuse existing components and conventions where sensible; avoid unnecessary dependencies and framework migrations.
- Validate at narrow and wide viewports.
- Keep UI code maintainable and avoid giant components or duplicated styles.
- Check the result in the browser or through the project's available verification tools when possible.
- Explain important design decisions and report what was actually verified.
