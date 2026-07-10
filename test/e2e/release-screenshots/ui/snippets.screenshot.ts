/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations, paintBackdrop } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#ea580c';
// Extra width on the right of the picker crop so `right-outside` badges
// aren't clipped. ~6px gap + ~24px badge + ~10px breathing room.
const LABEL_GUTTER = 48;

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await app.workbench.hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Snippets', () => {

	/**
	 * Img Path: https://positron.posit.co/images/snippets-configure-snippets.png
	 *
	 * Captures the top of the "Snippets: Configure Snippets" quick-pick: the
	 * search box plus the first two rows (Global / workspace) and the start of
	 * the alphabetical language list.
	 */
	test('Release Screenshot - snippets-configure-snippets.png', async ({ app, page, r }) => {
		const { quickaccess, quickInput } = app.workbench;

		await quickaccess.runCommand('Snippets: Configure Snippets', { keepOpen: true });
		const picker = quickInput.widget;
		await expect(picker).toBeVisible();

		const globalRow = quickInput.rowByAriaLabelPrefix('New Global Snippets file');
		const workspaceRow = quickInput.rowByAriaLabelPrefix('New Snippets file for');
		await expect(globalRow).toBeVisible();
		await expect(workspaceRow).toBeVisible();

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'my-project');

		// Crop to the top of the picker (search box + first ~5 rows); the full
		// picker has 100+ language rows. Extra width on the right gives the
		// right-outside badges room to render without being clipped.
		const pickerBox = await picker.boundingBox();
		if (!pickerBox) {
			throw new Error('Could not measure quick-input picker');
		}
		const rowBox = await globalRow.boundingBox();
		const rowHeight = rowBox?.height ?? 24;
		const cropHeight = Math.ceil((rowBox?.y ?? pickerBox.y) - pickerBox.y + rowHeight * 5);

		// White backdrop in the gutter so the right-outside badges sit on a
		// clean surface, not on whatever workbench content is behind the picker.
		await paintBackdrop(page, {
			x: pickerBox.x + pickerBox.width,
			y: pickerBox.y,
			width: LABEL_GUTTER,
			height: cropHeight,
		});

		await annotate(page, [
			{ selector: '.monaco-list-row[aria-label^="New Global Snippets file"]', label: '1', color: ANNOTATION_COLOR, padding: 1, labelPosition: 'right-outside', borderWidth: 1 },
			{ selector: '.monaco-list-row[aria-label^="New Snippets file for"]', label: '2', color: ANNOTATION_COLOR, padding: 1, labelPosition: 'right-outside', borderWidth: 1 },
		]);

		await captureRegion(page, 'snippets-configure-snippets.png', {
			x: Math.floor(pickerBox.x),
			y: Math.floor(pickerBox.y),
			width: Math.ceil(pickerBox.width) + LABEL_GUTTER,
			height: cropHeight,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-configure-language-specific-snippets.png
	 *
	 * Captures the picker scrolled so python/quarto/r are all rendered, with
	 * an orange outline around those three rows.
	 */
	test('Release Screenshot - snippets-configure-language-specific-snippets.png', async ({ app, page, r }) => {
		const { quickaccess, quickInput } = app.workbench;

		// Open the "Snippets: Configure Snippets" picker
		await quickaccess.runCommand('Snippets: Configure Snippets', { keepOpen: true });
		const picker = quickInput.widget;
		await expect(picker).toBeVisible();

		// Anchor on the snippets-specific first row so we know the snippets
		// picker (not the command palette) is active before scrolling.
		await expect(quickInput.rowByAriaLabelPrefix('New Global Snippets file')).toBeVisible();

		// Scroll the picker so python/quarto/r are all rendered.
		const pythonRow = quickInput.rowByAriaLabelPrefix('python, (');
		const quartoRow = quickInput.rowByAriaLabelPrefix('quarto, (');
		const rRow = quickInput.rowByAriaLabelPrefix('r, (');
		await quickInput.scrollIntoView([pythonRow, quartoRow, rRow]);

		const pickerBox = await picker.boundingBox();
		if (!pickerBox) {
			throw new Error('Could not measure quick-input picker');
		}

		// scrollIntoView leaves python somewhere in the middle of the visible
		// list (lots of unrelated languages above). Press ArrowDown more to
		// shift the list up — each press scrolls one row when focus is below
		// the visible bottom. Target: python at the 3rd visible row so the
		// docs framing shows powershell, properties, python, quarto, r.
		const TARGET_CONTEXT_ROWS = 2;
		const listBox = await quickInput.quickInputList.boundingBox();
		const pythonBoxAfterScroll = await pythonRow.boundingBox();
		if (listBox && pythonBoxAfterScroll) {
			const rowHeight = pythonBoxAfterScroll.height;
			const targetPythonY = listBox.y + TARGET_CONTEXT_ROWS * rowHeight;
			const rowsToShift = Math.max(0, Math.round((pythonBoxAfterScroll.y - targetPythonY) / rowHeight));
			for (let i = 0; i < rowsToShift; i++) {
				await page.keyboard.press('ArrowDown');
			}
		}

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'my-project');

		const rBox = await rRow.boundingBox();
		if (!rBox) {
			throw new Error('Could not measure r row');
		}
		// Extra space below the r row so the annotation's bottom border
		// (padding=1 + 1px stroke) and any sub-pixel anti-aliasing don't
		// get clipped at the crop edge.
		const BOTTOM_PAD = 6;
		const height = Math.ceil((rBox.y + rBox.height + BOTTOM_PAD) - pickerBox.y);

		// White backdrop in the gutter so the right-outside badge sits on a
		// clean surface, not on whatever workbench content is behind the picker.
		await paintBackdrop(page, {
			x: pickerBox.x + pickerBox.width,
			y: pickerBox.y,
			width: LABEL_GUTTER,
			height,
		});

		await annotate(page, [
			{
				selector: [
					'.quick-input-list .monaco-list-row[aria-label^="python, ("]',
					'.quick-input-list .monaco-list-row[aria-label^="quarto, ("]',
					'.quick-input-list .monaco-list-row[aria-label^="r, ("]',
				],
				label: '3',
				color: ANNOTATION_COLOR,
				padding: 1,
				labelPosition: 'right-outside',
				borderWidth: 1,
			},
		]);

		await captureRegion(page, 'snippets-configure-language-specific-snippets.png', {
			x: Math.floor(pickerBox.x),
			y: Math.floor(pickerBox.y),
			width: Math.ceil(pickerBox.width) + LABEL_GUTTER,
			height,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-for-example.png
	 *
	 * Type `for` at the R console prompt, navigate to the snippet entry so the
	 * details panel renders the snippet body, then capture the union of the
	 * console input line, suggest widget, and overlay-positioned details panel.
	 */
	test('Release Screenshot - snippets-for-example.png', async ({ app, page, r }) => {
		const { console: consolePane, sessions, suggestWidget } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Type `for` at the R console prompt
		await consolePane.typeToConsole('for');
		await suggestWidget.trigger();
		await suggestWidget.focusSnippetRow();
		await suggestWidget.toggleDetails();

		await prepareForScreenshot(app, page);
		// Capture the union of the console input line + suggest widget + the
		// (overlay-positioned) details panel. Cap the suggest widget height at
		// the first few rows so the docs framing matches the original (the
		// widget itself shows ~11 rows, but the reference only includes the
		// for-loop entries before unrelated matches like `force`, `formals`).
		const suggestBox = await suggestWidget.widget.boundingBox();
		const detailsBox = await suggestWidget.detailsContainer.boundingBox();
		const consoleInputBox = await page.locator('div.console-input').first().boundingBox();
		if (!suggestBox || !detailsBox || !consoleInputBox) {
			throw new Error('Could not measure suggest widget / details panel / console input');
		}
		const VISIBLE_ROWS = 4; // for [keyword], for snippet, forcats::, foreign::
		const firstRowBox = await suggestWidget.widget.locator('.monaco-list-row').first().boundingBox();
		const rowHeight = firstRowBox?.height ?? 22;
		// Anchor to the first row's y (not the widget's outer top edge) so
		// the crop bottom accounts for any widget chrome above the list.
		const rowsTop = firstRowBox?.y ?? suggestBox.y;
		const suggestBottom = rowsTop + VISIBLE_ROWS * rowHeight;
		const left = Math.floor(Math.min(suggestBox.x, consoleInputBox.x));
		const top = Math.floor(Math.min(suggestBox.y, detailsBox.y, consoleInputBox.y));
		const right = Math.ceil(Math.max(suggestBox.x + suggestBox.width, detailsBox.x + detailsBox.width));
		const bottom = Math.ceil(Math.max(suggestBottom, detailsBox.y + detailsBox.height));
		await captureRegion(page, 'snippets-for-example.png', {
			x: left,
			y: top,
			width: right - left,
			height: bottom - top,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-keyword-with-two-items.png
	 *
	 * Type `fun` in a fresh R file and annotate the snippet row ("Define a
	 * function") and the keyword row ([keyword] / function).
	 */
	test('Release Screenshot - snippets-keyword-with-two-items.png', async ({ app, page, openFile, r }) => {
		const { editor, sessions, suggestWidget } = app.workbench;

		await sessions.expectAllSessionsToBeReady();
		writeFileSync(join(app.workspacePathOrFolder, 'snippet-demo.R'), '\n');
		await openFile('snippet-demo.R');

		// Type `fun` in the R file and trigger the suggest widget
		await editor.type('fun');
		await suggestWidget.trigger();

		// Wait for the two target rows to be visible.
		const funRow = suggestWidget.rowByText('Define a function').first();
		const functionKeywordRow = suggestWidget.widget
			.locator('.monaco-list-row', { hasText: '[keyword]' })
			.filter({ hasText: /\bfunction\b/ })
			.first();
		await expect(funRow).toBeVisible({ timeout: 5_000 });
		await expect(functionKeywordRow).toBeVisible({ timeout: 5_000 });

		// Prepare for the screenshot, THEN tag the rows. prepareForScreenshot's
		// waitForStableUI step drains rAF / waits 250ms, during which Monaco's
		// virtualised list may recycle DOM rows and strip injected data-*
		// attributes. Tagging after the settle keeps the attrs alive for annotate().
		await prepareForScreenshot(app, page);
		await suggestWidget.tagRow('Define a function', 'snippet-fun');
		await suggestWidget.tagRowByRegex(/\bfunction\b.*\[keyword\]|\[keyword\].*\bfunction\b/, 'keyword-function');

		await annotate(page, [
			{ selector: '[data-screenshot-target="snippet-fun"]', label: '', color: ANNOTATION_COLOR, padding: 1, borderWidth: 1 },
			{ selector: '[data-screenshot-target="keyword-function"]', label: '', color: ANNOTATION_COLOR, padding: 1, borderWidth: 1 },
		]);

		// Crop to the widget width but end just below the keyword row so the
		// shot matches the docs framing (annotated rows + a couple of
		// follow-ups, not the full ~10-row scroll buffer).
		const widgetBox = await suggestWidget.widget.boundingBox();
		const lastRowBox = await page.locator('[data-screenshot-target="keyword-function"]').boundingBox();
		if (!widgetBox || !lastRowBox) {
			throw new Error('Could not measure suggest widget / keyword row');
		}
		const cropBottom = lastRowBox.y + lastRowBox.height + 4;
		await captureRegion(page, 'snippets-keyword-with-two-items.png', {
			x: Math.floor(widgetBox.x),
			y: Math.floor(widgetBox.y),
			width: Math.ceil(widgetBox.width),
			height: Math.ceil(cropBottom - widgetBox.y),
		});
	});
});
