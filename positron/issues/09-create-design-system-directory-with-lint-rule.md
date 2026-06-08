# Create designSystem/ directory with ESLint boundary rule

## Parent

positron/prd-notebook-design-system.md

## What to build

Create the `src/vs/workbench/contrib/positronNotebook/browser/designSystem/` directory. Add an ESLint rule (custom rule or `no-restricted-imports` configuration) that prevents files within this directory from importing DI service hooks (`usePositronReactServicesContext`, `useNotebookInstance`, `useCell`, `useCodeCell`, or any other context/DI hook).

This structurally enforces that components in `designSystem/` are DI-free and therefore extractable.

## Acceptance criteria

- [ ] `designSystem/` directory exists
- [ ] ESLint rule flags any import of DI hooks from within `designSystem/` files
- [ ] ESLint rule passes for files that only import React, CSS, and other `designSystem/` modules
- [ ] Rule is tested (ESLint `RuleTester` or equivalent)
- [ ] Rule violation produces a clear error message explaining the boundary

## Blocked by

None - can start immediately
