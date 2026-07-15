# Assertions and Waiting Patterns

We follow standard Playwright best practices, documented at
[playwright.dev](https://playwright.dev/docs/best-practices).

This file covers only the Positron-specific parts and the calls that are easy to
get wrong:

- which retry mechanism to use (`toPass` vs `expect.poll` vs a plain web-first assertion)
- where to find the POM assertion helpers

## Choosing a retry mechanism

Three tools retry, and picking the wrong one is the most common mistake. Decide
by **what** needs retrying: the checked value, or the action that produces it.

| Situation | Use |
|-----------|-----|
| Checking a Locator's state (visible, text, count, ...) | `expect(locator).toBe...({ timeout })` -- already retries internally |
| The **action** might need reissuing (a click/keypress that occasionally doesn't register), not just the state re-checked | `toPass` |
| A matcher a Locator assertion lacks (e.g. "count greater than N"), or a non-Locator value (API call, `page.evaluate`, computed state) | `expect.poll` |

### toPass: retry an action and its check

Use it when the action itself might not register: a click, a keypress, a menu
trigger. The whole callback (action + assertion) is retried together.

```typescript
// Inner timeout must be SHORT so each attempt fails fast and toPass
// actually gets to retry within its own budget.
await expect(async () => {
	await button.click();
	await expect(dialog).toBeVisible({ timeout: 2000 });
}).toPass({ timeout: 10000 });
```

### expect.poll: retry a value against a matcher

Use it for the narrow cases where web-first assertions aren't enough. `expect.poll` retries a function
and asserts on its return value: it can re-read state, but it can't reissue a UI action.

```typescript
// A matcher Locator assertions lack -- toHaveCount has no "greater than"
await expect.poll(async () => (await locator.all()).length).toBeGreaterThan(2);

// A non-Locator value (API call, computed state, page.evaluate)
await expect.poll(async () => await getValue(), { timeout: 30000 }).toBe('expected');
```

## Preferred Selectors

Same priority as [Playwright's guidance](https://playwright.dev/docs/best-practices#use-locators)
-- prefer selectors that verify real user-facing/accessible behavior. Listed here
because other skill files point at this as the canonical order.

1. **Accessible labels and roles** -- `getByRole('button', { name: 'Execute' })`, `getByLabel('Clear console')`
2. **Test IDs** -- `getByTestId('data-grid-cell-0-0')`. Reliable, but doesn't verify accessibility and needs manual upkeep.
3. **Text content** -- `getByText('Python')`, `filter({ hasText: 'expected' })`
4. **CSS selectors** -- `page.locator('.monaco-workbench')`. Least stable; use only when nothing above fits.

## Positron assertion helpers

Most Positron assertions go through POM methods rather than raw locators. See
[page-objects.md](page-objects.md) for usage idioms, and read the POM source for
the authoritative method list; don't guess a method name.
