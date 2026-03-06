# Demo Patterns

Common patterns for writing demo scripts.

## Basic Structure

Every demo script follows this template:

```typescript
import { test, expect } from '../tests/_test.setup';
import { pause, humanType, humanClick } from './demo-utils';

test.use({
	suiteId: __filename,
});

test.setTimeout(300_000);

test.describe('Demo: <Feature Name>', () => {
	test('walkthrough', async function ({ app, page }) {
		await pause(page, 2000); // Let app settle

		// ... demo steps ...

		await pause(page, 2000); // Hold on final state
	});
});
```

## Console Demo

```typescript
test('console demo', async function ({ app, page, python }) {
	const cons = app.workbench.console;

	await pause(page, 1500);

	// Type and execute code
	await humanType(page, cons.activeConsole, 'import pandas as pd');
	await pause(page, 500);
	await page.keyboard.press('Enter');
	await pause(page, 1500);

	await humanType(page, cons.activeConsole, 'df = pd.read_csv("data.csv")');
	await pause(page, 500);
	await page.keyboard.press('Enter');
	await pause(page, 2000);
});
```

## Notebook Demo

```typescript
test('notebook demo', async function ({ app, page, openFile }) {
	const notebooks = app.workbench.notebooks;

	await openFile('workspaces/example/notebook.ipynb');
	await pause(page, 2000);

	// Click into a cell
	await humanClick(page, page.locator('.cell').first());
	await pause(page, 800);

	// Type code
	await humanType(page, page.locator('.cell .native-edit-context'), 'print("hello")');
	await pause(page, 1000);

	// Run cell
	await page.keyboard.press('Shift+Enter');
	await pause(page, 2000); // Wait for output to appear
});
```

## Data Explorer Demo

```typescript
test('data explorer demo', async function ({ app, page, python }) {
	const cons = app.workbench.console;
	const variables = app.workbench.variables;

	// Create a dataframe
	await cons.executeCode('Python', 'import pandas as pd\ndf = pd.DataFrame({"a": [1,2,3], "b": [4,5,6]})');
	await pause(page, 1500);

	// Open in data explorer
	await variables.doubleClickVariableRow('df');
	await pause(page, 2000);

	// Interact with the data explorer
	// ... clicks, sorts, filters ...
});
```

## Drag and Drop Demo

```typescript
test('drag and drop demo', async function ({ app, page }) {
	// Get source and target elements
	const source = page.locator('.draggable-item').nth(2);
	const target = page.locator('.draggable-item').nth(0);

	await pause(page, 1000);

	// Hover over source first (shows intent)
	await source.hover();
	await pause(page, 500);

	// Perform the drag
	await source.dragTo(target);
	await pause(page, 1500); // Let viewer see the result
});
```

## Tips

### Pacing
- More pauses = easier to follow
- 800ms minimum between any two actions
- 1500-2000ms after visual changes (output appearing, panels opening)
- 2000ms at start and end

### Viewport
- Default video size is 1280x720
- If the feature needs more space, adjust in the DEMO_RECORD_VIDEO setup

### Multiple Steps
- Use `test.step()` to label sections (helps with debugging, not visible in video)
- Consider splitting very long demos into multiple test cases

### Adapting Existing Tests
When adapting an e2e test:
1. Copy the test file to `test/e2e/demos/<name>.demo.test.ts`
2. Change imports to include demo-utils
3. Add `test.setTimeout(300_000)`
4. Insert `pause()` calls between each action
5. Replace `locator.fill()` with `humanType()` for visible typing
6. Remove assertions that aren't needed (or keep them -- they won't affect the video)
