/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { promises as fs } from 'fs';
import { test, tags, expect } from './_test.setup';

test.use({
	suiteId: __filename
});

const FIXTURE_REL_PATH = join('workspaces', 'quarto_inline_output', 'widget_scroll_trap.qmd');

// Line of the code cell that renders the widget.
const CELL_LINE = 9;

// A Quarto document whose first cell renders an R htmlwidget (highcharter).
// htmlwidget output routes through the raw-HTML overlay webview -- the same
// rendering path as R's flextable output from the bug report. A short intro
// above the cell keeps the widget off the very top of the editor (so it has
// room to move up while staying on screen), and the filler paragraphs below
// give the document somewhere to scroll to.
function fixtureContent(): string {
	const filler = Array.from(
		{ length: 200 },
		(_, i) => `Line ${i + 1}: The quick brown fox jumps over the lazy dog while the widget is wheeled.`
	).join('\n');
	return `---
title: "Widget Scroll Trap Test"
engine: knitr
---

Intro paragraph so the widget is not pinned to the top of the editor and has
room to scroll upward while remaining on screen.

\`\`\`{r}
library(highcharter)
hchart(data.frame(x = 1:5, y = c(1, 4, 9, 16, 25)), "scatter", hcaes(x, y))
\`\`\`

## Filler section

${filler}
`;
}

test.describe('Quarto - Inline Output: Widget scroll trap', {
	tag: [tags.QUARTO]
}, () => {

	test.beforeEach(async function ({ app }) {
		await fs.writeFile(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), fixtureContent(), 'utf8');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await fs.rm(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), { force: true });
	});

	// Regression test for posit-dev/positron#14620: R HTML widgets rendered as
	// inline-output overlay webviews used to be scroll traps -- once the pointer
	// entered the widget, wheel events were captured by the webview iframe and
	// never reached the outer Quarto document. Wheeling over a widget that has no
	// scrollable content of its own must scroll the surrounding document.
	test('R - Verify wheeling over a widget scrolls the outer document', async function ({ r, app, openFile, page }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('widget_scroll_trap.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('widget_scroll_trap.qmd');
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();

		// The overlay webview appears once the htmlwidget renders.
		const webview = page.locator('iframe.webview').first();
		await expect(webview).toBeVisible({ timeout: 120000 });

		// Reveal the cell so the widget sits mid-editor with room to scroll.
		await inlineQuarto.gotoLine(CELL_LINE);
		await expect(webview).toBeVisible();

		const boxBefore = await webview.boundingBox();
		expect(boxBefore).not.toBeNull();

		// Wheel downward over the center of the widget. We dispatch a real
		// WheelEvent inside the widget's rendered content frame rather than using
		// page.mouse.wheel: Playwright's synthetic mouse wheel is not delivered
		// into the webview's out-of-process iframe, so it cannot reach the widget
		// at all. Dispatching into the content document exercises the true fix
		// path -- the injected preload's wheel listener runs its inner-scroll
		// heuristic, posts a `wheelForward` message across the iframe boundary,
		// and the view zone applies it to the editor's scroll position. The
		// scatter plot has no inner vertical scroller, so the scroll must
		// propagate out to the Quarto document rather than being trapped.
		const WHEEL_DELTA_Y = 300;
		const contentFrame = page.frameLocator('iframe.webview').frameLocator('#active-frame');
		await expect(contentFrame.locator('body')).toBeVisible();
		await contentFrame.locator('body').evaluate((body, deltaY) => {
			const view = body.ownerDocument.defaultView!;
			const target = body.ownerDocument.elementFromPoint(
				view.innerWidth / 2,
				view.innerHeight / 2
			) ?? body;
			target.dispatchEvent(new WheelEvent('wheel', {
				deltaY,
				deltaMode: 0, // DOM_DELTA_PIXEL
				bubbles: true,
				cancelable: true,
			}));
		}, WHEEL_DELTA_Y);

		// The document scrolled: the widget's view zone moved up by roughly the
		// wheel delta. Before the fix the widget trapped the scroll and its top y
		// did not move at all.
		await expect.poll(async () => {
			const box = await webview.boundingBox();
			return box === null ? -Infinity : box.y;
		}, { timeout: 10000 }).toBeLessThan(boxBefore!.y - (WHEEL_DELTA_Y / 2));
	});
});
