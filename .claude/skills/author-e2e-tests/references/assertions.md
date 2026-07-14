# Assertions and Waiting Patterns

Standard Playwright works the way [playwright.dev](https://playwright.dev/docs/best-practices)
documents it, so this file doesn't repeat it: web-first assertions,
`locator.waitFor` and the other wait primitives, soft assertions, `page.pause()`
debugging, and role/label/text selectors over CSS. Assume all of that.

This file covers only the Positron-specific parts and the calls that are easy to
get wrong:

- which retry mechanism to use (`toPass` vs `expect.poll` vs a plain web-first assertion)
- Positron's timeout budgets
- where to find the POM assertion helpers

## Choosing a retry mechanism

Three tools retry, and picking the wrong one is the most common mistake. Decide
by **what** needs retrying: the checked value, or the action that produces it.

| Situation | Use |
|-----------|-----|
| Checking a Locator's state (visible, text, count, ...) | `expect(locator).toBe...({ timeout })` -- already retries internally |
| The **action** might need reissuing (a click/keypress that occasionally doesn't register), not just the state re-checked | `toPass` |
| A matcher a Locator assertion lacks (e.g. "count greater than N"), or a non-Locator value (API call, `page.evaluate`, computed state) | `expect.poll` |

Do **not** wrap a single web-first assertion (or a POM `expectTo...`/`verify...`/
`waitFor...` method, which is built on one) in `toPass` or `expect.poll` -- it
already retries via its own `timeout`. Raise that `timeout` instead.

### toPass: retry an action and its check

```typescript
// Inner timeout must be SHORT so each attempt fails fast and toPass
// actually gets to retry within its own budget.
await expect(async () => {
	await button.click();
	await expect(dialog).toBeVisible({ timeout: 2000 });
}).toPass({ timeout: 10000 });
```

Use it when the action itself might not take -- a click, a keypress, a menu
trigger. The whole callback (action + assertion) is retried together.

### expect.poll: retry a value against a matcher

`expect.poll` retries a function and checks its *return value*. It can't reissue
a UI action; it only re-reads. Reach for it in the narrow cases web-first
assertions don't cover:

```typescript
// A matcher Locator assertions lack -- toHaveCount has no "greater than"
await expect.poll(async () => (await locator.all()).length).toBeGreaterThan(2);

// A non-Locator value (API call, computed state, page.evaluate)
await expect.poll(async () => await getValue(), { timeout: 30000 }).toBe('expected');
```

## Positron timeout budgets

Domain-specific values that Playwright's defaults don't anticipate. Defaults live
in `playwright.config.ts` (assertion + action timeout 15s, test timeout 2min).

| Operation | Timeout | Reason |
|-----------|---------|--------|
| UI visibility | 15000ms | Default, most UI appears quickly |
| Console ready | 30000ms | Interpreter startup can be slow |
| Code execution | 30000-60000ms | Depends on code complexity |
| Data loading | 60000ms | Large datasets take time |
| Network operations | 30000ms | API calls, downloads |
| Session startup | 45000ms | Kernel initialization |

## Preferred Selectors

Same priority as [Playwright's guidance](https://playwright.dev/docs/best-practices#use-locators)
-- prefer selectors that verify real user-facing/accessible behavior. Listed here
because other skill files point at this as the canonical order.

1. **Accessible labels and roles** -- `getByRole('button', { name: 'Execute' })`, `getByLabel('Clear console')`
2. **Test IDs** -- `getByTestId('data-grid-cell-0-0')`. Reliable, but doesn't verify accessibility and needs manual upkeep.
3. **Text content** -- `getByText('Python')`, `filter({ hasText: 'expected' })`
4. **CSS selectors** -- `page.locator('.monaco-workbench')`. Least stable; use only when nothing above fits.

## Positron assertion helpers

Most Positron assertions go through POM methods (`waitForConsoleContents`,
`verifyTableData`, `expectVariableToBe`, `verifyTab`,
`verifyExplorerFilesExist`, ...) rather than raw locators. See
[page-objects.md](page-objects.md) for usage idioms, and read the POM source for
the authoritative method list -- don't guess a method name.
