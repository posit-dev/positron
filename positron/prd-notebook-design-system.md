# PRD: Positron Notebook Design System

## Problem Statement

The Positron Notebook Editor has grown to ~65 React components across 36+ CSS files with no shared design language. Colors, spacing, and typography are specified ad-hoc -- sometimes as raw hex values, sometimes as direct `--vscode-*` references, sometimes as magic numbers. There is no way to browse components in isolation, verify visual consistency, or identify reusable primitives without reading through the full source tree. This makes it hard for contributors to build new UI that looks and feels consistent, and impossible to extract reusable pieces for other parts of Positron.

## Solution

Build a phased design system scoped to the Notebook Editor as a proving ground:

1. **Component catalog (Storybook 8)** -- Browse and interact with notebook components in isolation, powered by mock DI services and generated theme CSS.
2. **Semantic token layer** -- A set of `--positron-*` CSS custom properties that alias `--vscode-*` values, giving components a meaningful vocabulary (e.g., `--positron-surface-primary`) instead of raw theme keys.
3. **Extractable component library** -- A structurally-enforced directory of DI-free components that can eventually be consumed outside the notebook editor.

The system is for the Positron team only (internal standardization), not external extension authors.

## User Stories

1. As a Positron contributor, I want to browse all notebook UI components visually in Storybook, so that I can understand what's available before building something new.
2. As a Positron contributor, I want components in Storybook to look identical to the running app (dark and light themes), so that I can trust the catalog as a source of truth.
3. As a Positron contributor, I want to see a service-dependent component (e.g., `NotebookCellActionBar`) render in Storybook with mock services, so that I don't need to launch the full app to iterate on complex UI.
4. As a Positron contributor, I want `.stories.tsx` files co-located next to their components, so that I can find and update stories without navigating a separate directory tree.
5. As a Positron contributor, I want Storybook's Vite config to reuse our existing `vitest.config.ts` resolution, so that import paths work identically in tests and stories.
6. As a Positron contributor, I want a Storybook decorator that wraps components in `createTestContainer().withReactServices()`, so that I write stories the same way I write tests.
7. As a Positron contributor, I want semantic CSS tokens like `--positron-surface-primary` instead of remembering which `--vscode-editor-*` variable to use, so that my CSS communicates intent.
8. As a Positron contributor, I want the token layer to alias VS Code's theme variables (not replace them), so that upstream themes and dark/light mode continue to work without migration.
9. As a Positron contributor, I want a lint rule that prevents components in the `designSystem/` directory from importing DI services, so that extractability is enforced at build time.
10. As a Positron contributor, I want to know at a glance which components are "design system primitives" (DI-free) vs. "Positron-specific" (service-dependent), so that I choose the right abstraction level.
11. As a Positron contributor, I want Storybook to generate `--vscode-*` custom properties from VS Code's theme JSON files, so that theming works without manually extracting values from a running app.
12. As a Positron contributor, I want to run Storybook locally with a single command (`npm run storybook`), so that there's no multi-step setup.
13. As a Positron contributor, I want token documentation rendered as a Storybook page (color swatches, spacing scale, typography), so that design decisions are browsable alongside components.
14. As a Positron contributor, I want existing utility components (`ActionButton`, `IconedButton`, `SplitButton`) to be the first residents of the `designSystem/` directory, so that extraction starts with proven, DI-free code.
15. As a Positron contributor, I want the design system to not affect the production build or bundle size, so that Storybook and story files are dev-only.

## Implementation Decisions

### Phase 1: Storybook Spike

- **Tool**: Storybook 8 with Vite builder (`@storybook/react-vite`).
- **Bundler resolution**: The Storybook Vite config will extend the existing `vitest.config.ts` resolve settings (`.js` extension handling, path aliases, TypeScript transforms). This avoids maintaining two resolve configurations.
- **DI mock layer**: A shared Storybook decorator will call `createTestContainer().withReactServices().build()` and wrap the story in the resulting React services context. This is the same infrastructure vitest uses -- stories and tests share the mock layer.
- **Theme CSS generation**: A build-time script reads VS Code's theme JSON files (e.g., `src/vs/workbench/common/theme.ts` color registry, `extensions/theme-defaults/themes/`) and emits a CSS file defining all `--vscode-*` custom properties for dark and light variants. Storybook loads this via `preview-head.html` or a decorator.
- **First story target**: `NotebookCellActionBar` -- a service-dependent component that validates the full mock path works. If this renders, simpler components are trivial.
- **Story file convention**: `*.stories.tsx` co-located next to the component file. Storybook glob: `src/vs/workbench/contrib/positronNotebook/browser/**/*.stories.tsx`.
- **Production exclusion**: Stories are excluded from the TypeScript `tsconfig.json` compilation via a glob exclude, and the Storybook config directory (`.storybook/`) lives at the repo root or under a top-level `tools/` directory.

### Phase 2: Token Layer

- **Token namespace**: `--positron-*` (e.g., `--positron-surface-primary`, `--positron-text-secondary`, `--positron-border-subtle`).
- **Aliasing strategy**: Each semantic token resolves to a `--vscode-*` variable via `var()` fallback chains. Example: `--positron-surface-primary: var(--vscode-editor-background)`. Upstream themes keep working; the semantic layer adds meaning on top.
- **Scope**: Tokens cover colors, spacing scale, border radii, font sizes, and font families used within the notebook editor. Not a universal Positron token set (yet).
- **Migration**: Notebook CSS files are migrated incrementally -- new code uses tokens, existing code is updated component-by-component.
- **Documentation**: A dedicated Storybook MDX page renders token swatches and values.

### Phase 3: Extractable Library

- **Directory**: `src/vs/workbench/contrib/positronNotebook/browser/designSystem/`.
- **Boundary enforcement**: An ESLint rule (custom or `no-restricted-imports`) prevents files in `designSystem/` from importing `usePositronReactServicesContext`, `useNotebookInstance`, or any other DI/context hook.
- **Initial residents**: `ActionButton`, `IconedButton`, `SplitButton` (already DI-free).
- **Growth pattern**: As components are refactored to accept data via props instead of reading services directly, they move into `designSystem/`. The wrapping "connected" component stays outside and passes props from services.

### Architecture Notes

- **Observable handling in stories**: Components using `useObservedValue()` need observables in their context. The test container's mock notebook instance provides static observable values. Stories can override these via Storybook controls/args to show different states.
- **CSS loading**: Storybook's Vite builder handles `.css` imports natively. No special loader configuration needed.
- **No monorepo extraction yet**: The `designSystem/` directory is a structural boundary within the existing source tree, not a separate package. Monorepo extraction is a future phase beyond this PRD.

## Testing Decisions

### What makes a good test here

Tests verify external behavior: "does the component render the right output given these props/services?" not "does it call `useState` three times." For the design system specifically, visual regression tests (Storybook's Chromatic or similar) are the gold standard -- but those are out of scope for the initial spike.

### What gets tested

- **Theme CSS generator**: Unit tests that the script correctly transforms VS Code theme JSON into CSS custom property declarations. Pure function, trivial to test.
- **Storybook decorator**: A vitest that verifies `createTestContainer().withReactServices()` produces a context object that satisfies `PositronReactServices` shape. (This is likely already tested by existing vitest infrastructure -- verify, don't duplicate.)
- **Lint rule (Phase 3)**: Test that the ESLint rule correctly flags DI imports in `designSystem/` files and passes for DI-free files. Standard ESLint rule testing with `RuleTester`.

### Prior art

- Vitest + RTL tests in `src/vs/workbench/contrib/positronNotebook/test/browser/` (e.g., `emptyConsole.vitest.tsx`) demonstrate the `createTestContainer().withReactServices()` pattern.
- ESLint rule tests exist in the repo's lint configuration for layering rules.

## Out of Scope

- **Visual regression testing** (Chromatic, Percy, or similar snapshot diffing). Valuable but a separate initiative.
- **External consumers** -- no NPM package, no public API contract, no versioning scheme.
- **Non-notebook components** -- other Positron views (data explorer, console, plots) are not in scope for this phase, though the patterns established here should generalize.
- **Upstream VS Code components** -- we don't catalog or extract VS Code's own widgets (tree view, list view, etc.).
- **Design tooling integration** (Figma tokens sync, design-to-code pipelines).
- **Runtime theme switching in Storybook** -- initial implementation provides static dark/light theme files; a theme switcher toolbar addon is a future enhancement.
- **Accessibility auditing** -- Storybook's a11y addon is not in scope for the spike but is a natural Phase 1.5 addition.

## Further Notes

- The Positron Notebook Editor is a good proving ground because it's self-contained (~65 components), actively developed, and has a mix of DI-free primitives and service-heavy domain components. Lessons learned here will inform whether to expand the design system to other Positron views.
- The `createTestContainer()` builder was purpose-built for test isolation. Reusing it for Storybook is a bet that test mocks are "good enough" for visual development. If stories need richer interactivity (e.g., a command palette that actually does something), the decorator can be extended incrementally without rearchitecting.
- The theme JSON parsing approach may miss runtime-computed values (e.g., colors derived from user settings). This is an acceptable tradeoff for the spike -- the generated theme will cover 95%+ of variables. Edge cases can be patched manually.
