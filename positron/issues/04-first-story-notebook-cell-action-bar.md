# First story: NotebookCellActionBar (hard case)

## Parent

positron/prd-notebook-design-system.md

## What to build

A `.stories.tsx` file for `NotebookCellActionBar` -- a component that depends on DI services, notebook instance context, and cell context. This is the validation story: if it renders correctly in Storybook with proper theming and mock services, the entire approach is proven.

The story should show the action bar in at least two states (e.g., code cell selected, markdown cell selected) using Storybook controls or separate story variants.

## Acceptance criteria

- [ ] `NotebookCellActionBar.stories.tsx` exists co-located with the component
- [ ] The component renders visually correct (buttons visible, icons load, themed colors applied)
- [ ] At least two meaningful states are demonstrated (different cell types or selection states)
- [ ] No console errors related to missing services or undefined observables
- [ ] Theme CSS (from issue 02) is loaded so colors match the real app

## Blocked by

- 03-di-mock-decorator.md
