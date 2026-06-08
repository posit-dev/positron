# Token documentation page in Storybook

## Parent

positron/prd-notebook-design-system.md

## What to build

An MDX documentation page in Storybook that renders the semantic token vocabulary visually: color swatches, spacing scale, typography samples, border radii. Each token shows its name, current resolved value (in dark and light themes), and the `--vscode-*` variable it aliases.

This page serves as the living reference for contributors choosing tokens when writing new CSS.

## Acceptance criteria

- [ ] Storybook MDX page renders all semantic tokens grouped by category (color, spacing, typography, borders)
- [ ] Color tokens show visual swatches in both dark and light themes
- [ ] Spacing tokens show visual size comparison
- [ ] Each token row shows: name, alias target, rendered value
- [ ] Page is discoverable in Storybook's sidebar navigation

## Blocked by

- 05-stories-for-utility-components.md
- 07-implement-token-alias-layer.md
