# Theme CSS generator from VS Code JSON

## Parent

positron/prd-notebook-design-system.md

## What to build

A build-time script that reads VS Code's theme JSON files (color registry in `src/vs/workbench/common/theme.ts`, default themes in `extensions/theme-defaults/themes/`) and emits CSS files defining all `--vscode-*` custom properties for dark and light variants.

The output CSS is loaded by Storybook so that components look production-accurate without a running workbench. The script should be runnable standalone (`node scripts/generate-theme-css.mjs` or similar) and produce deterministic output for a given set of theme inputs.

## Acceptance criteria

- [ ] Script parses VS Code theme JSON and emits a CSS file with `--vscode-*` custom properties
- [ ] Both dark and light theme variants are generated
- [ ] Generated CSS covers the variables used by notebook components (spot-check against a running Positron instance)
- [ ] Script is deterministic (same input produces identical output)
- [ ] Output files are gitignored or committed as generated artifacts (team decision, but script must be re-runnable)

## Blocked by

- 01-bootstrap-storybook.md
