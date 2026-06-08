# Move DI-free components into designSystem/

## Parent

positron/prd-notebook-design-system.md

## What to build

Move the existing DI-free utility components (`ActionButton`, `IconedButton`, `SplitButton`) and their co-located CSS files into the `designSystem/` directory. Update all import paths in consuming components. Verify the ESLint boundary rule passes for the moved files.

Update the Storybook story paths if needed (stories stay co-located, so they move with the components).

## Acceptance criteria

- [ ] `ActionButton`, `IconedButton`, `SplitButton` (+ CSS) live in `designSystem/`
- [ ] All consuming components import from the new paths without errors
- [ ] ESLint boundary rule passes for all moved files
- [ ] Storybook stories still render correctly after the move
- [ ] No visual or functional regressions in the running notebook editor

## Blocked by

- 09-create-design-system-directory-with-lint-rule.md
