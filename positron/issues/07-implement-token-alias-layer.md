# Implement token alias layer and migrate notebook CSS

## Parent

positron/prd-notebook-design-system.md

## What to build

Create a CSS file that defines the approved semantic tokens as aliases to `--vscode-*` variables (e.g., `--positron-surface-primary: var(--vscode-editor-background)`). This file is imported by the notebook editor's root CSS.

Migrate existing notebook CSS files to use the new semantic tokens instead of raw `--vscode-*` references or hardcoded values. Migration is incremental -- prioritize the most-used values and the components that already have stories.

## Acceptance criteria

- [ ] Token definition CSS file exists and is loaded by the notebook editor
- [ ] Tokens resolve correctly in both dark and light themes
- [ ] At least the utility components (`ActionButton`, `IconedButton`, `SplitButton`) and `NotebookCellActionBar` use tokens instead of raw values
- [ ] No visual regressions in the running app (tokens alias to the same values that were hardcoded before)
- [ ] New notebook CSS contributions are expected to use tokens (documented in contributing guide or code review convention)

## Blocked by

- 06-define-semantic-token-vocabulary.md
