# Stories for DI-free utility components

## Parent

positron/prd-notebook-design-system.md

## What to build

Stories for the three DI-free utility components: `ActionButton`, `IconedButton`, and `SplitButton`. These don't need the DI mock decorator (though it won't hurt if applied globally). Each story should demonstrate the component's prop API with multiple variants (sizes, disabled state, with/without icon, etc.) using Storybook controls.

These serve as the baseline "easy" stories and validate that plain components work in the Storybook + Vite + CSS pipeline.

## Acceptance criteria

- [ ] `ActionButton.stories.tsx` with variants showing different props
- [ ] `IconedButton.stories.tsx` with icon + label combinations
- [ ] `SplitButton.stories.tsx` with dropdown menu items
- [ ] All three render with correct styling (CSS co-located files load properly)
- [ ] Storybook controls allow interactive prop manipulation

## Blocked by

- 01-bootstrap-storybook.md
