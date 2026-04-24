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

Use `@testing-library/jest-dom` matchers: `toBeInTheDocument`, `toHaveTextContent`, `toHaveClass`, `toHaveFocus`, `toBeDisabled`, `toBeChecked`, `toBeVisible`, `toHaveAttribute`, `toHaveValue`, `toHaveStyle`, etc. Prefer the dedicated matcher over manual property reads (`el.classList.contains`, `el.textContent`, `el.disabled`, `el.checked`, `el.getAttribute`, `el.value`, `document.activeElement`).

For pure existence checks, wrap in `expect(...).toBeInTheDocument()`: `expect(screen.getByRole('alert')).toBeInTheDocument()`. Every assertion then leads with `expect(`, which reads uniformly. **Use `toBeInTheDocument()` with `getBy*` for presence or `queryBy*` / `findBy*` for absence** -- not with `queryBy*` for presence (use `getBy*`) and not with `getBy*` for absence (use `queryBy*`).

Prefer `@testing-library/user-event` over `fireEvent` -- user-event fires the full event sequence a real user triggers. Set up once per test: `const user = userEvent.setup(); await user.click(button)`.

## Escape hatches

When no semantic query fits (structural div with no role, label, or stable text):

1. **Preferred:** add `data-testid` to the source component, use `getByTestId(...)`. This is the right fix even when a `container.querySelector('.my-class')` *would* compile -- class selectors couple the test to CSS internals, while a testid is an explicit test contract the component author maintains on purpose. Most Positron components are under our control, so the source edit is usually a one-line prop addition. Prefer this over class-based `querySelector` even if it means touching source.
2. **Fallback** (only when touching source truly isn't feasible, e.g. a third-party renderer or a structural invariant under test): `getByText('text', { selector: '.css' })` if the element has text; otherwise `expect(container.querySelector('.x')).toBeInTheDocument()` paired with a jest-dom matcher and an inline comment explaining why no semantic query or testid is possible. `querySelector` is flagged by the `no-restricted-syntax` rule -- disable per line with `// eslint-disable-next-line no-restricted-syntax -- <reason>`.

## Enforcement

RTL rules are enforced by `eslint-plugin-testing-library` (query/action patterns) and `eslint-plugin-jest-dom` (matcher preferences — AST-level detection of `.classList.contains`, `.textContent`, `document.activeElement`, etc., where a jest-dom matcher is cleaner). See the `testing-library/*` and `jest-dom/*` entries in [`eslint.config.js`](../../eslint.config.js) for the enabled rules. Run `npx eslint --max-warnings 0 <file>` to check.

Treat `// eslint-disable*.*(testing-library|jest-dom)/` as a red flag: each disable needs a one-line comment naming the real constraint (not "async is inconvenient" or "fireEvent works"). The lint rules encode the project's RTL conventions — silencing one without justification reintroduces the anti-pattern the rule was written to prevent.

## Showcase tests

- [emptyConsole](../../src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx) -- one service, one click, behavioral assertions
- [webviewPlotThumbnail](../../src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx) -- one emitter, `act()`, conditional rendering
- [startupStatus](../../src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx) -- 6-phase state machine, 3 event subscriptions
- [columnSummaryCell](../../src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx) -- RTL idioms: `expect(screen.getByText('text', { selector })).toBeInTheDocument()` (explicit wrap), no `querySelector`
