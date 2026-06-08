# Define semantic token vocabulary + audit notebook CSS

## Parent

positron/prd-notebook-design-system.md

## What to build

Audit all CSS files in the notebook editor to catalog every color, spacing value, font size, and border radius in use. Group them into semantic categories and propose a token vocabulary (e.g., `--positron-surface-primary`, `--positron-text-muted`, `--positron-spacing-sm`).

The output is a token specification document (which tokens exist, what they alias, when to use each one). This requires human review to validate naming decisions and ensure the vocabulary matches how the team thinks about the UI.

**This is a HITL slice** -- the token names need team sign-off before migration begins.

## Acceptance criteria

- [ ] Complete audit of raw values in notebook CSS files (colors, spacing, fonts, radii)
- [ ] Proposed token vocabulary with semantic names, organized by category
- [ ] Each token mapped to its `--vscode-*` alias (or fallback chain)
- [ ] Usage guidance: when to use `--positron-surface-primary` vs `--positron-surface-secondary`, etc.
- [ ] Team review and approval of the vocabulary

## Blocked by

None - can start immediately
