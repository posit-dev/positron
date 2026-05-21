/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { capturePanel, captureRegion } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#ea580c';

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
	test('Release Screenshot - snippets-configure-snippets.png', async ({ app, page }) => {
		const { quickaccess } = app.workbench;

		await quickaccess.runCommand('Snippets: Configure Snippets', { keepOpen: true });
		const picker = page.locator('.quick-input-widget');
		await expect(picker).toBeVisible();
		// The first two list rows ("New Global Snippets file..." and the
		// workspace-scoped entry) need to be rendered before we measure.
		await expect(picker.locator('.quick-input-list .monaco-list-row').first()).toBeVisible();

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');

		// Highlight the two rows the docs flow numbers as steps 1 + 2. Monaco
		// list rows are virtualized so DOM order != logical order; match by
		// aria-label prefix instead.
		const globalRow = picker.locator('.monaco-list-row[aria-label^="New Global Snippets file"]');
		const workspaceRow = picker.locator('.monaco-list-row[aria-label^="New Snippets file for"]');
		await expect(globalRow).toBeVisible();
		await expect(workspaceRow).toBeVisible();
		await annotate(page, [
			{ selector: '.monaco-list-row[aria-label^="New Global Snippets file"]', label: '1', color: ANNOTATION_COLOR, padding: 1, labelPosition: 'top-right' },
			{ selector: '.monaco-list-row[aria-label^="New Snippets file for"]', label: '2', color: ANNOTATION_COLOR, padding: 1, labelPosition: 'top-right' },
		]);

		// Crop to the top of the picker (search box + first ~5 rows) to match
		// the docs visual; the full picker has 100+ rows.
		const pickerBox = await picker.boundingBox();
		if (!pickerBox) {
			throw new Error('Could not measure quick-input picker');
		}
		const rowBox = await globalRow.boundingBox();
		const rowHeight = rowBox?.height ?? 24;
		// Input row plus the first 5 list rows = top of picker we want to keep.
		const cropHeight = Math.ceil((rowBox?.y ?? pickerBox.y) - pickerBox.y + rowHeight * 5);
		await captureRegion(page, 'snippets-configure-snippets.png', {
			x: Math.floor(pickerBox.x),
			y: Math.floor(pickerBox.y),
			width: Math.ceil(pickerBox.width),
			height: cropHeight,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-configure-language-specific-snippets.png
	 *
	 * Captures the same picker scrolled so python/quarto/r are in view, with
	 * an orange outline around those three rows to match the docs visual.
	 */
	test('Release Screenshot - snippets-configure-language-specific-snippets.png', async ({ app, page }) => {
		const { quickaccess } = app.workbench;

		await quickaccess.runCommand('Snippets: Configure Snippets', { keepOpen: true });
		const picker = page.locator('.quick-input-widget');
		await expect(picker).toBeVisible();
		// Wait for the snippets picker (not the command palette) by anchoring
		// on the unique "New Global Snippets file..." row.
		await expect(picker.locator('.monaco-list-row[aria-label^="New Global Snippets file"]')).toBeVisible();

		const pythonRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="python, ("]');
		const quartoRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="quarto, ("]');
		const rRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="r, ("]');

		// Walk the picker selection down with ArrowDown until python/quarto/r
		// are all rendered. Mouse-wheel doesn't reliably scroll the virtualized
		// list in Linux CI; keyboard navigation works everywhere. We require
		// all three rows visible together (not just python) because the list
		// only renders ~20 rows; if python is at the bottom of the viewport,
		// quarto/r below it haven't been virtualized in yet.
		await expect(async () => {
			await page.keyboard.press('ArrowDown');
			await expect(pythonRow).toBeVisible({ timeout: 100 });
			await expect(quartoRow).toBeVisible({ timeout: 100 });
			await expect(rRow).toBeVisible({ timeout: 100 });
		}).toPass({ timeout: 60000, intervals: [50] });

		const pickerBox = await picker.boundingBox();
		if (!pickerBox) {
			throw new Error('Could not measure quick-input picker');
		}

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');

		// Single union annotation around all three language rows (replaces the
		// docs' separate "3." arrows).
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
				labelPosition: 'top-right',
			},
		]);

		// Crop from the picker top through the bottom of the R row so the
		// search box and the highlighted languages are both in frame.
		const rBox = await rRow.boundingBox();
		if (!rBox) {
			throw new Error('Could not measure r row');
		}
		const height = Math.ceil((rBox.y + rBox.height) - pickerBox.y);
		await captureRegion(page, 'snippets-configure-language-specific-snippets.png', {
			x: Math.floor(pickerBox.x),
			y: Math.floor(pickerBox.y),
			width: Math.ceil(pickerBox.width),
			height,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-for-example.png
	 *
	 * Open a fresh R file, type `for`, navigate to the snippet entry so the
	 * details panel renders the snippet body, then capture the suggest widget.
	 */
	test('Release Screenshot - snippets-for-example.png', async ({ app, page, openFile, r }) => {
		const { editor, sessions } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Minimal R buffer so the suggest widget isn't polluted by identifiers
		// scraped from existing code (`functionBody`, `findUnique`, etc.).
		const filePath = join(app.workspacePathOrFolder, 'snippet-demo.R');
		writeFileSync(filePath, '\n');
		await openFile('snippet-demo.R');

		await editor.type('for');
		// Trigger the suggest widget explicitly (typing alone doesn't always
		// open it for R, and the test needs to drive selection deterministically).
		await expect(async () => {
			await page.keyboard.press('Control+Space');
			await expect(page.locator('.suggest-widget.visible')).toBeVisible({ timeout: 3000 });
		}).toPass({ timeout: 15000 });
		const suggest = page.locator('.suggest-widget.visible');

		// Walk selection down until the focused row is the snippet (the
		// keyword `for` typically appears above the `for` snippet).
		const focused = suggest.locator('.monaco-list-row.focused');
		const isFocusedSnippet = async () =>
			focused.locator('.codicon-symbol-snippet').first().isVisible().catch(() => false);
		for (let i = 0; i < 8 && !(await isFocusedSnippet()); i++) {
			await page.keyboard.press('ArrowDown');
		}
		// Toggle the details panel so the snippet body renders to the side.
		// Ctrl+Space when the widget is visible runs `toggleSuggestionDetails`
		// (same binding as Trigger Suggest, disambiguated by widget visibility).
		const details = page.locator('.suggest-details-container');
		await expect(async () => {
			await page.keyboard.press('Control+Space');
			await expect(details).toBeVisible({ timeout: 2000 });
		}).toPass({ timeout: 10000 });

		await prepareForScreenshot(app, page);
		// Capture the union of the suggest widget + the (overlay-positioned)
		// details panel so the snippet body shows alongside the list.
		const suggestBox = await suggest.boundingBox();
		const detailsBox = await details.boundingBox();
		if (!suggestBox || !detailsBox) {
			throw new Error('Could not measure suggest widget / details panel');
		}
		const left = Math.floor(Math.min(suggestBox.x, detailsBox.x));
		const top = Math.floor(Math.min(suggestBox.y, detailsBox.y));
		const right = Math.ceil(Math.max(suggestBox.x + suggestBox.width, detailsBox.x + detailsBox.width));
		const bottom = Math.ceil(Math.max(suggestBox.y + suggestBox.height, detailsBox.y + detailsBox.height));
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
	 * Type `fun` in a fresh R file and annotate the snippet row ("fun" / Function
	 * skeleton) and the keyword row ("function" / [keyword]).
	 */
	test('Release Screenshot - snippets-keyword-with-two-items.png', async ({ app, page, openFile, r }) => {
		const { editor, sessions } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		const filePath = join(app.workspacePathOrFolder, 'snippet-demo.R');
		writeFileSync(filePath, '\n');
		await openFile('snippet-demo.R');

		await editor.type('fun');
		await expect(async () => {
			await page.keyboard.press('Control+Space');
			await expect(page.locator('.suggest-widget.visible')).toBeVisible({ timeout: 3000 });
		}).toPass({ timeout: 15000 });
		const suggest = page.locator('.suggest-widget.visible');

		// Wait until both rows we want to annotate are rendered. The positron-r
		// `fun` snippet describes itself as "Define a function"; the keyword
		// row shows `[keyword]` in its trailing meta.
		const funRow = suggest.locator('.monaco-list-row', { hasText: 'Define a function' }).first();
		const functionKeywordRow = suggest.locator('.monaco-list-row', { hasText: '[keyword]' }).filter({ hasText: /\bfunction\b/ }).first();
		await expect(funRow).toBeVisible({ timeout: 5000 });
		await expect(functionKeywordRow).toBeVisible({ timeout: 5000 });

		// Tag the two target rows so annotate() (which uses plain querySelector)
		// can find them without Playwright's :has-text engine.
		await page.evaluate(() => {
			const rows = document.querySelectorAll('.suggest-widget .monaco-list-row');
			for (const row of rows) {
				const text = row.textContent ?? '';
				if (text.includes('Define a function')) {
					row.setAttribute('data-screenshot-target', 'snippet-fun');
				} else if (text.includes('[keyword]') && /\bfunction\b/.test(text)) {
					row.setAttribute('data-screenshot-target', 'keyword-function');
				}
			}
		});

		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '[data-screenshot-target="snippet-fun"]', label: '', color: ANNOTATION_COLOR, padding: 1 },
			{ selector: '[data-screenshot-target="keyword-function"]', label: '', color: ANNOTATION_COLOR, padding: 1 },
		]);

		await capturePanel(page, suggest, 'snippets-keyword-with-two-items.png');
	});
});
