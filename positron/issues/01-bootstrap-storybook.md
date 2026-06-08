# Bootstrap Storybook 8 with Vite builder

## Parent

positron/prd-notebook-design-system.md

## What to build

Install Storybook 8 with the `@storybook/react-vite` framework. Configure the Vite builder to reuse the existing `vitest.config.ts` resolve settings (`.js` extension handling, path aliases, TypeScript transforms). Add a story glob targeting `src/vs/workbench/contrib/positronNotebook/browser/**/*.stories.tsx`. Create one trivial placeholder story (e.g., a raw `<div>`) that proves the pipeline compiles, serves, and renders.

Add an `npm run storybook` script to `package.json`. Ensure story files are excluded from the production TypeScript compilation (`tsconfig.json` excludes).

## Acceptance criteria

- [ ] `npm run storybook` launches a working Storybook dev server
- [ ] Vite resolves `.js` extension imports and path aliases identically to vitest
- [ ] A placeholder `.stories.tsx` file renders in the browser
- [ ] Story files are excluded from `tsconfig.json` (no production build impact)
- [ ] No new dependencies appear in the production bundle

## Blocked by

None - can start immediately
