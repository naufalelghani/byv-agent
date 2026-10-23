---
name: ui-ux-pro-max
description: Apply a systematic UX and visual-design review to choose appropriate styles, palettes, typography, layout, and interaction patterns.
---

# UI/UX Pro Max — BYV Agent bundled guidance

Use this skill when designing a new interface, choosing a design system, or auditing an existing user experience. This bundled guide provides a practical decision framework; it does not require a separate manual installation.

## Design intelligence workflow
1. **Context:** Identify product domain, audience, core user journeys, platform, accessibility needs, and project constraints.
2. **Style direction:** Choose a visual style that supports the product's purpose and audience. State why it fits; do not default to the same gradient-card dashboard for every project.
3. **Palette:** Define semantic roles (background, surface, text, muted text, primary, accent, border, success, warning, danger). Check contrast and avoid relying on color alone.
4. **Typography:** Select a legible type scale and a restrained font pairing. Prefer project-provided fonts; if external fonts are used, account for loading, privacy, and fallback behavior.
5. **Layout:** Map information priority to page structure, grid, spacing, and responsive breakpoints. Make primary actions easy to find.
6. **Components:** Specify consistent buttons, inputs, cards, navigation, tables, dialogs, and feedback states.
7. **Interaction and accessibility:** Review keyboard flow, focus, labels, error messages, touch targets, reduced motion, and semantic HTML.
8. **Quality pass:** Check visual consistency, responsive overflow, empty/loading/error states, and whether decorative elements distract from the task.

## Practical guardrails
- Prefer a small, consistent design-token system over one-off styling.
- Avoid unsupported claims, fake metrics, unnecessary UI, and visual clutter.
- Do not add a library or remote asset merely to satisfy a style preference.
- Keep designs aligned with existing product requirements and documented frontend stack.
- If a project has an established design system, extend it rather than replacing it.
- Record key style, palette, and typography choices briefly when useful for handoff.

This is a self-contained BYV Agent skill, not a vendored copy of any third-party skill repository or its optional scripts/data.