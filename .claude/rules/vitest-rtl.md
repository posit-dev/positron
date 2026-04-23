---
paths:
  - src/**/*.vitest.tsx
  - src/vs/test/vitest/reactTestingLibrary.*
---

# Positron Vitest + React Testing Library

For React component tests (`*.vitest.tsx` using `setupRTLRenderer()`). Read alongside [`vitest-tests.md`](vitest-tests.md) for the builder, file layout, and run commands.

## Getting started

Grep the component for `usePositronReactServicesContext`. If it appears anywhere in the file (or a child rendered via context uses it), your test needs the service-context pattern. When in doubt, use service-context -- it works for both.

1. Copy `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`
2. Change these 4 things (everything else is boilerplate):

```tsx
// (1) Your component import
import { MyComponent } from '../../browser/components/myComponent.js';
// (2) Your service import (only if you need to stub a service)
import { IMyService } from '...';

describe('MyComponent', () => {
    const ctx = createTestContainer()
        .withReactServices()
        .stub(IMyService, { getData: vi.fn() })  // (3) Your stubs
        .build();
    const rtl = setupRTLRenderer(() => ctx.reactServices);

    it('renders', () => {
        rtl.render(<MyComponent />);              // (4) Your component + assertions
    });
});
```

3. Run: `npx vitest run src/vs/path/to/yourTest.vitest.tsx`
4. If it fails with "missing service" errors, add more `.stub()` calls

## Query priority

Prefer Testing Library queries in this order: `getByRole` -> `getByLabelText` -> `getByPlaceholderText` -> `getByText` -> `getByDisplayValue` -> `getByAltText` -> `getByTitle` -> `getByTestId`. Use `getByText('text', { selector: '.css' })` or `getByTestId(...)` when role/label aren't available -- add a brief inline comment if the choice isn't obvious.

## Assertions

Use `@testing-library/jest-dom` matchers: `toBeInTheDocument`, `toHaveTextContent`, `toHaveClass`, `toBeDisabled`, `toBeVisible`, `toHaveAttribute`, etc. Prefer the dedicated matcher over manual property reads (`el.classList.contains`, `el.textContent`, `el.disabled`, `el.getAttribute`).

For pure existence checks, wrap in `expect(...).toBeInTheDocument()`: `expect(screen.getByRole('alert')).toBeInTheDocument()`. Every assertion then leads with `expect(`, which reads uniformly. **Use `toBeInTheDocument()` with `getBy*` for presence or `queryBy*` / `findBy*` for absence** -- not with `queryBy*` for presence (use `getBy*`) and not with `getBy*` for absence (use `queryBy*`).

Prefer `@testing-library/user-event` over `fireEvent` -- user-event fires the full event sequence a real user triggers. Set up once per test: `const user = userEvent.setup(); await user.click(button)`.

## Escape hatches

When no semantic query fits (structural div with no role, label, or stable text):

1. **Best:** add `data-testid` to the source component, use `getByTestId(...)`.
2. **Acceptable** (when touching source isn't feasible): `getByText('text', { selector: '.css' })` if the element has text; otherwise `expect(container.querySelector('.x')).toBeInTheDocument()` paired with a jest-dom matcher and an inline comment explaining why no semantic query fits. `querySelector` is also flagged by `local/no-restricted-syntax` -- disable it per line with `// eslint-disable-next-line no-restricted-syntax` + the comment.

## Enforcement

Most rules below are enforced by `eslint-plugin-testing-library` (see `eslint.config.js`). Run `npx eslint <file>` when in doubt.

- `prefer-explicit-assert` -- wrap bare `getBy*` in `expect(...).toBeInTheDocument()`
- `prefer-presence-queries` -- `getBy*` for presence, `queryBy*` for absence
- `prefer-screen-queries` -- use `screen.getByX(...)` over destructuring queries from `render`
- `prefer-user-event` -- use `userEvent`, not `fireEvent`
- `no-render-in-lifecycle` -- no `render()` inside `beforeEach` / `beforeAll`
- `no-debugging-utils` -- no committed `screen.debug()` or `logTestingPlaygroundURL()`
- `no-unnecessary-act` -- RTL auto-wraps `render` / `userEvent`; don't wrap again
- `await-async-queries` / `await-async-utils` / `no-await-sync-queries` -- correct `await` on async queries and utilities

## Showcase tests

- [emptyConsole](../../src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx) -- one service, one click, behavioral assertions
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- one emitter, `act()`, conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- 6-phase state machine, 3 event subscriptions
- [columnSummaryCell](../../src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx) -- RTL idioms: `expect(screen.getByText('text', { selector })).toBeInTheDocument()` (explicit wrap), no `querySelector`
