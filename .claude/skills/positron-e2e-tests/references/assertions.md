# Assertions and Waiting Patterns

Complete guide to assertions, waits, and reliability patterns in Positron e2e tests.

## Basic Assertions

### Visibility Assertions

```typescript
// Element visible
await expect(locator).toBeVisible();
await expect(locator).toBeVisible({ timeout: 30000 });

// Element hidden/not visible
await expect(locator).toBeHidden();
await expect(locator).not.toBeVisible();
await expect(locator).toBeHidden({ timeout: 15000 });
```

### Text Assertions

```typescript
// Exact text match
await expect(locator).toHaveText('exact text');
await expect(locator).toHaveText('exact text', { timeout: 15000 });

// Contains text
await expect(locator).toContainText('partial');
await expect(locator).toContainText(/regex pattern/);

// Multiple elements text
await expect(locator).toHaveText(['item1', 'item2', 'item3']);
```

### Count Assertions

```typescript
// Exact count
await expect(locator).toHaveCount(3);
await expect(locator).toHaveCount(3, { timeout: 15000 });

// At least one
await expect(locator).toHaveCount(1);

// None (element doesn't exist)
await expect(locator).toHaveCount(0);
```

### Attribute Assertions

```typescript
// Has attribute with value
await expect(locator).toHaveAttribute('aria-label', 'Expected Label');
await expect(locator).toHaveAttribute('data-state', 'active');

// Attribute matches regex
await expect(locator).toHaveAttribute('aria-label', /Python/);

// Has class
await expect(locator).toHaveClass(/selected/);
await expect(locator).toHaveClass('my-class');
```

### Value Assertions

```typescript
// Input value
await expect(input).toHaveValue('expected value');
await expect(input).toHaveValue(/partial/);

// Checkbox/Radio checked
await expect(checkbox).toBeChecked();
await expect(checkbox).not.toBeChecked();

// Element enabled/disabled
await expect(button).toBeEnabled();
await expect(button).toBeDisabled();
```

## Waiting Patterns

### Wait for Condition with toPass

The most important pattern for handling timing issues:

```typescript
// Retry until assertion passes
await expect(async () => {
	await someAction();
	await expect(result).toBeVisible();
}).toPass({ timeout: 15000 });

// With multiple assertions
await expect(async () => {
	const count = await locator.count();
	expect(count).toBeGreaterThan(0);

	const text = await locator.first().textContent();
	expect(text).toContain('expected');
}).toPass({ timeout: 30000 });
```

**When to use `toPass`:**
- Operations that may need retries (clicking, typing)
- Actions that have race conditions
- Cleanup operations that may not work first time
- Any operation where timing is unpredictable

### expect.poll

Poll a function until condition is met:

```typescript
// Poll for count
await expect.poll(async () => {
	return (await locator.all()).length;
}).toBeGreaterThan(2);

// Poll for value
await expect.poll(async () => {
	return await getValue();
}, { timeout: 30000 }).toBe('expected');

// Poll with intervals
await expect.poll(async () => {
	return await checkStatus();
}, {
	timeout: 60000,
	intervals: [1000, 2000, 5000]  // Check at 1s, 2s, 5s intervals
}).toBe('ready');
```

### Wait for Network/State

```typescript
// Wait for navigation
await page.waitForURL('**/expected-path');

// Wait for load state
await page.waitForLoadState('domcontentloaded');
await page.waitForLoadState('networkidle');

// Wait for response
await page.waitForResponse(response =>
	response.url().includes('/api/data') && response.status() === 200
);
```

### Wait for Element State

```typescript
// Wait for element to exist
await locator.waitFor();
await locator.waitFor({ state: 'attached' });

// Wait for element to be visible
await locator.waitFor({ state: 'visible', timeout: 30000 });

// Wait for element to be hidden
await locator.waitFor({ state: 'hidden' });

// Wait for element to be detached from DOM
await locator.waitFor({ state: 'detached' });
```

## Timeout Guidelines

### Default Timeouts

- **Assertion timeout**: 15 seconds (Playwright default)
- **Action timeout**: 30 seconds (in page objects)
- **Test timeout**: 2 minutes (configured in playwright.config.ts)

### Recommended Timeout Values

| Operation | Timeout | Reason |
|-----------|---------|--------|
| UI visibility | 15000ms | Default, most UI appears quickly |
| Console ready | 30000ms | Interpreter startup can be slow |
| Code execution | 30000-60000ms | Depends on code complexity |
| Data loading | 60000ms | Large datasets take time |
| Network operations | 30000ms | API calls, downloads |
| Session startup | 45000ms | Kernel initialization |

### Setting Timeouts

```typescript
// Per-assertion timeout
await expect(locator).toBeVisible({ timeout: 30000 });

// Per-action timeout
await locator.click({ timeout: 10000 });

// toPass timeout
await expect(async () => {
	// ...
}).toPass({ timeout: 15000 });
```

## Locator Strategies

### Preferred Selectors (Most to Least Reliable)

1. **Test IDs** (most stable)
```typescript
page.getByTestId('restart-session')
page.getByTestId('data-grid-cell-0-0')
```

2. **Accessible Labels**
```typescript
page.getByLabel('Clear console')
page.getByRole('button', { name: 'Execute' })
page.getByRole('tab', { name: 'Console', exact: true })
```

3. **Text Content**
```typescript
page.getByText('Python')
page.getByText(/started/)
locator.filter({ hasText: 'expected' })
```

4. **CSS Selectors** (less stable, but sometimes necessary)
```typescript
page.locator('.monaco-workbench')
page.locator('[id="workbench.panel.positronSession"]')
```

### Combining Locators

```typescript
// Filter by text
page.locator('.console-instance').filter({ hasText: 'Python' })

// Chain locators
page.locator('.variable-item').locator('.name-column')

// Has descendant
page.locator('.cell').filter({ has: page.getByText('output') })

// Nth element
page.locator('.item').nth(0)
page.locator('.item').first()
page.locator('.item').last()
```

### Frame Locators (Webviews)

```typescript
// Single frame
page.frameLocator('.webview').locator('.content')

// Nested frames
page.frameLocator('.webview').frameLocator('#active-frame').locator('.output')
```

## Common Assertion Patterns

### Verify Console Output

```typescript
// Wait for specific text
await app.workbench.console.waitForConsoleContents('expected output');

// Wait for regex match
await app.workbench.console.waitForConsoleContents(/Python.*started/);

// Wait for exact count of matches
await app.workbench.console.waitForConsoleContents('success', {
	expectedCount: 2,
	timeout: 30000
});

// Verify text does NOT appear
await app.workbench.console.waitForConsoleContents('error', {
	expectedCount: 0,
	timeout: 5000
});
```

### Verify Data Explorer Contents

```typescript
await app.workbench.dataExplorer.grid.verifyTableData([
	{ 'Name': 'Alice', 'Age': '30', 'City': 'NYC' },
	{ 'Name': 'Bob', 'Age': '25', 'City': 'LA' }
], 60000);
```

### Verify Variable Exists

```typescript
await app.workbench.variables.waitForVariable('df');
await app.workbench.variables.waitForVariableValue('x', '42');
```

### Verify Editor Tab

```typescript
await app.workbench.editors.verifyTab('Data: df', { isVisible: true });
await app.workbench.editors.verifyTab('script.py', { isActive: true });
```

### Verify Files Created

```typescript
await app.workbench.explorer.verifyExplorerFilesExist([
	'output.csv',
	'plot.png'
]);
```

## Retry Patterns for Flaky Operations

### Click with Retry

```typescript
await expect(async () => {
	await button.click();
	await expect(dialog).toBeVisible();
}).toPass({ timeout: 10000 });
```

### Clear with Retry (for plots, editors, etc.)

```typescript
await expect(async () => {
	await hotKeys.clearPlots();
	await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
}).toPass({ timeout: 15000 });
```

### Menu Interaction with Retry

```typescript
await expect(async () => {
	await menuTrigger.click();
	await expect(menuItem).toBeVisible();
}).toPass({ timeout: 5000 });

await menuItem.click();
```

### Dialog with Retry

```typescript
await expect(async () => {
	if (!await dialog.isVisible()) {
		await triggerButton.click();
	}
	await expect(dialog).toBeVisible();
}).toPass({ timeout: 5000 });
```

## Negative Assertions

### Element Should NOT Appear

```typescript
// Check element doesn't exist
await expect(locator).toHaveCount(0);

// Check element hidden
await expect(locator).toBeHidden({ timeout: 5000 });

// Wait for disappearance
await locator.waitFor({ state: 'hidden', timeout: 10000 });
```

### Error Should NOT Occur

```typescript
// Verify no error toast
await app.workbench.toasts.verifyNoToasts();

// Verify no console error
await app.workbench.console.waitForConsoleContents('Error', {
	expectedCount: 0,
	timeout: 5000
});
```

## Soft Assertions

For non-critical checks that shouldn't fail the test:

```typescript
// Soft assertion (continues even if fails)
await expect.soft(locator).toBeVisible();
await expect.soft(locator).toHaveText('expected');

// Check if any soft assertions failed
expect(test.info().errors).toHaveLength(0);
```

## Debugging Failed Assertions

### Add Context to Assertions

```typescript
// Custom error message
await expect(locator, 'Dialog should be visible after clicking button').toBeVisible();

// Using test.step for context
await test.step('Open settings dialog', async () => {
	await settingsButton.click();
	await expect(settingsDialog).toBeVisible();
});
```

### Screenshots on Failure

Automatic - Playwright captures screenshots on assertion failure.

### Manual Debugging

```typescript
// Pause execution
await page.pause();

// Log locator info
console.log(await locator.count());
console.log(await locator.textContent());
console.log(await locator.isVisible());

// Take manual screenshot
await page.screenshot({ path: 'debug.png' });
```
