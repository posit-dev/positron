# DI mock decorator using createTestContainer

## Parent

positron/prd-notebook-design-system.md

## What to build

A Storybook decorator that wraps every story in the React services context provided by `createTestContainer().withReactServices().build()`. This gives service-dependent components (those using `usePositronReactServicesContext()`) a working DI context in Storybook, using the same mock infrastructure as vitest.

The decorator should also provide a mock notebook instance context (for components using `useNotebookInstance()`) with static observable values. Stories can override specific service stubs or observable values via Storybook args/controls where useful.

## Acceptance criteria

- [ ] A shared Storybook decorator exists that provides `PositronReactServices` context
- [ ] Components calling `usePositronReactServicesContext()` render without errors
- [ ] Components calling `useNotebookInstance()` receive a mock instance with static observables
- [ ] The decorator uses `createTestContainer` (not a hand-rolled mock layer)
- [ ] Individual stories can override specific service stubs via args

## Blocked by

- 01-bootstrap-storybook.md
