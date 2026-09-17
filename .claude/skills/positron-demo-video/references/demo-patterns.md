# Demo Patterns

Common patterns for writing demo scripts.

## Basic Structure

Every demo script follows this template:

```typescript
import { test } from '../tests/_test.setup';
import { pause, humanType, humanClick, setupDemoLayout, DEMO_SCREENCAST_SETTINGS } from './demo-utils';

test.use({
	suiteId: __filename,
	extraSettings: { ...DEMO_SCREENCAST_SETTINGS },
});

test.setTimeout(300_000);

test.describe('Demo: <Feature Name>', () => {
	test('walkthrough', async function ({ app, page }) {
		await setupDemoLayout(app, page); // Collapse panels + enable screencast mode
		await pause(page, 2000); // Let app settle

		// ... demo steps ...

		await pause(page, 2000); // Hold on final state
	});
});
```

**Pass screencast settings through `extraSettings`, not a `beforeApp` override.** Overriding
`beforeApp` replaces the default worker fixture in `test/e2e/tests/_test.setup.ts`, which is what
writes the feature flags behind `enableDataConnections` and friends. The failure looks nothing
like the cause: the feature you are demoing silently does not exist, and you get a missing-locator
error with no hint that a fixture ate your settings.

### Keep the area your demo happens in

`setupDemoLayout` closes the sidebar, panel, and auxiliary bar. Anything in the sidebar (Data
Connections, Explorer, SCM) needs it kept:

```typescript
await setupDemoLayout(app, page, { keepSidebar: true });
```

It also clears startup notifications, which otherwise sit in frame: the Supervisor version warning
and the requirements.txt prompt both land a few seconds into a recording.

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

## Zoom to Area of Interest

```typescript
import { zoomTo, zoomReset, showOverlay, pause } from './demo-utils';

// Zoom into a UI element to highlight detail
await showOverlay(page, 'The outline shows your notebook structure');
await zoomTo(page, page.locator('.outline-tree'), { scale: 2 });
await pause(page, 3000); // Hold so viewer can read
await zoomReset(page);
```

- Uses CSS transform on `.monaco-workbench` -- text stays sharp
- Automatically centers the target in the viewport (no left/right cutoff)
- Default: 2x scale, 600ms ease-in-out animation
- At 1920x1080, a 2x zoom still gives 960x540 effective resolution

## Clicks Must Be Drawn

Screencast mode renders the keystroke overlay, but it draws **nothing** for Playwright's
synthesized mouse events -- its mouse indicator only responds to real OS input. A demo that clicks
without a marker shows the UI changing state with no visible cause.

`humanClick` and `humanDoubleClick` draw a ring at the cursor for you. Use them instead of
`locator.click()` anywhere the click is part of what the viewer is meant to see.

```typescript
await humanClick(page, page.locator('.positron-tree-twisty-collapsed').first());
await humanDoubleClick(page, row);          // two rings, so it reads as a double-click
await humanClick(page, button, { ring: false });  // opt out
```

Page objects often click via `dispatchEvent`, which is invisible on video. When a page object
method exists but dispatches, either drive the mouse directly or accept that the step will not
read. Check why it dispatches first -- in virtualized trees it is working around a clip-path
hazard for rows below the fold, and coordinate clicks there land on the wrong row.

## Make Cosmetic Steps Non-Fatal

A recording costs a minute or two of app startup. A polish step that throws discards the whole
capture, so wrap anything whose failure should cost a nice frame rather than the run:

```typescript
await bestEffort('expand the notification', async () => {
	await toast.hover();
	await toast.locator('.codicon-notifications-expand').first().click({ timeout: 5000 });
});
```

Things that have actually failed this way: notification toolbars that only render on hover, view
resize commands, and anything driving quick input (see below).

## Quick Input and Screencast Mode Do Not Mix

Driving the quick input while screencast mode is on does not work -- the widget goes `hidden`
mid-interaction. This rules out `output.openOutputPane()` and anything else built on
`showQuickPick` during a recording.

When the demo needs to show that something happened off-screen, narrate it and assert against the
real source instead of opening a panel:

```typescript
await showOverlay(page, 'The extension re-registers its drivers');
await expect.poll(() => fs.readFileSync(logFile, 'utf-8').includes('reloading drivers'),
	{ timeout: 30_000 }).toBe(true);
```

That also makes the ordering deterministic, which a fixed `pause()` does not.

## Captions Must Not Lead the Action

A caption that appears before the thing it describes reads as a claim the video then has to
justify. Show the caption, then act -- or for a payoff, wait for the evidence and caption it after:

```typescript
await errorToast.waitFor({ state: 'visible' });
await showOverlay(page, 'But the handle is gone');   // not before the toast
```

Watch for captions that overclaim at the start, too: "a live, connected database" is wrong if the
live indicator only lights up after the first expand.

## Tips

### Pacing
- More pauses = easier to follow
- 800ms minimum between any two actions
- 1500-2000ms after visual changes (output appearing, panels opening)
- 2000ms at start and end

### Viewport
- Default capture canvas is 1920x1080
- The app window is usually smaller than the canvas, leaving a uniform gray bar on the right and
  bottom. `postprocess-demo-video.ts` measures and crops it. ffmpeg's own `cropdetect` does not
  find it, because the bar is gray (value 128) rather than black.

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
