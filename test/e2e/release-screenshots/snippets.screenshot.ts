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
		const rowsContainer = picker.locator('.quick-input-list .monaco-list-rows').first();
		await expect(rowsContainer).toBeVisible();

		// Scroll the list so python is visible. The picker is virtualized but
		// scrolling the rows container reliably triggers row rendering.
		await rowsContainer.evaluate((el) => {
			const target = el.querySelector('[aria-label^="python ("]') as HTMLElement | null;
			if (target) {
				target.scrollIntoView({ block: 'center' });
				return;
			}
			// Fallback: roughly halfway down the language list (~50 rows * 22px).
			(el as HTMLElement).scrollTop = 1100;
		});
		// Re-query after virtualized scroll repopulates rows.
		const pythonRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="python ("]');
		const quartoRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="quarto ("]');
		const rRow = picker.locator('.quick-input-list .monaco-list-row[aria-label^="r ("]');
		await expect(pythonRow).toBeVisible();
		await expect(quartoRow).toBeVisible();
		await expect(rRow).toBeVisible();

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');

		// Single union annotation around all three language rows (replaces the
		// docs' separate "3." arrows).
		await annotate(page, [
			{
				selector: [
					'.quick-input-list .monaco-list-row[aria-label^="python ("]',
					'.quick-input-list .monaco-list-row[aria-label^="quarto ("]',
					'.quick-input-list .monaco-list-row[aria-label^="r ("]',
				],
				label: '3',
				color: ANNOTATION_COLOR,
				padding: 1,
				labelPosition: 'top-right',
			},
		]);

		// Crop from the picker top through the bottom of the R row so the
		// search box and the highlighted languages are both in frame.
		const pickerBox = await picker.boundingBox();
		const rBox = await rRow.boundingBox();
		if (!pickerBox || !rBox) {
			throw new Error('Could not measure picker / rows');
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
	test('Release Screenshot - snippets-for-example.png', async ({ app, page, openFile }) => {
		const { editor } = app.workbench;

		// Minimal R buffer so the suggest widget isn't polluted by identifiers
		// scraped from existing code (`functionBody`, `findUnique`, etc.).
		const filePath = join(app.workspacePathOrFolder, 'snippet-demo.R');
		writeFileSync(filePath, '\n');
		await openFile('snippet-demo.R');

		await editor.type('for');

		const suggest = page.locator('.suggest-widget.visible');
		await expect(suggest).toBeVisible({ timeout: 10000 });

		// Walk selection down until the focused row is the snippet (not the
		// keyword), so the details panel renders the snippet body.
		const focused = suggest.locator('.monaco-list-row.focused');
		for (let i = 0; i < 8; i++) {
			const isSnippet = await focused
				.locator('.suggest-icon.codicon-symbol-snippet, .codicon-symbol-snippet')
				.first()
				.isVisible()
				.catch(() => false);
			if (isSnippet) {
				break;
			}
			await page.keyboard.press('ArrowDown');
		}
		const details = suggest.locator('.details');
		await expect(details).toBeVisible({ timeout: 5000 });

		await prepareForScreenshot(app, page);
		await capturePanel(page, suggest, 'snippets-for-example.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/snippets-keyword-with-two-items.png
	 *
	 * Type `fun` in a fresh R file and annotate the snippet row ("fun" / Function
	 * skeleton) and the keyword row ("function" / [keyword]).
	 */
	test('Release Screenshot - snippets-keyword-with-two-items.png', async ({ app, page, openFile }) => {
		const { editor } = app.workbench;

		const filePath = join(app.workspacePathOrFolder, 'snippet-demo.R');
		writeFileSync(filePath, '\n');
		await openFile('snippet-demo.R');

		await editor.type('fun');

		const suggest = page.locator('.suggest-widget.visible');
		await expect(suggest).toBeVisible({ timeout: 10000 });

		// Wait until both rows we want to annotate are rendered.
		const funRow = suggest.locator('.monaco-list-row', { hasText: 'Function skeleton' }).first();
		const functionKeywordRow = suggest.locator('.monaco-list-row', { hasText: '[keyword]' }).filter({ hasText: 'function' }).first();
		await expect(funRow).toBeVisible({ timeout: 5000 });
		await expect(functionKeywordRow).toBeVisible({ timeout: 5000 });

		// Tag the two target rows so annotate() (which uses plain querySelector)
		// can find them without Playwright's :has-text engine.
		await page.evaluate(() => {
			const rows = document.querySelectorAll('.suggest-widget .monaco-list-row');
			for (const row of rows) {
				const text = row.textContent ?? '';
				if (text.includes('Function skeleton')) {
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
