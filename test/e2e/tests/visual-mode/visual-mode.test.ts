/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { Application } from '../../infra';
import { Keyboard, Hotkeys } from '../../infra/fixtures/keyboard';

test.use({
	suiteId: __filename
});

const testCases = [
	{
		title: 'R Markdown',
		filePath: 'workspaces/visual-mode/visual-mode.rmd',
		tags: [tags.WEB, tags.VISUAL_MODE, tags.EDITOR, tags.R_MARKDOWN]
	},
	{
		title: 'Quarto Markdown',
		filePath: 'workspaces/visual-mode/visual-mode.qmd',
		tags: [tags.WEB, tags.VISUAL_MODE, tags.EDITOR, tags.QUARTO]
	},
	{
		title: 'Markdown',
		filePath: 'workspaces/visual-mode/visual-mode.md',
		tags: [tags.WEB, tags.VISUAL_MODE, tags.EDITOR]
	},

];

test.beforeAll('Check project name', async function ({ }, testInfo) {
	if (testInfo.project.name !== 'e2e-browser') {
		test.skip();
	}
});

test.beforeAll('Trigger and accept visual mode dialog', async function ({ openFile, runCommand, page, keyboard }) {
	await openFile(testCases[0].filePath, false);
	await runCommand('edit in visual mode');
	await page.getByText('Use Visual Mode').click();
	await keyboard.hotKeys(Hotkeys.CLOSE_ALL_EDITORS);
});


for (const { title, filePath, tags } of testCases) {
	test.describe(`Visual Mode: ${title} file`, { tag: tags }, () => {
		test.beforeEach(`Open file: ${filePath}`, async function ({ openFile }) {
			await openFile(filePath, false);
		});

		test.afterEach('close all editors', async function ({ app, keyboard }) {
			await keyboard.hotKeys(Hotkeys.CLOSE_ALL_EDITORS);
		});

		test('Verify Markdown Syntax Rendering', async function ({ page, app }) {
			await changeEditMode(page, 'Visual');
			await verifyMarkdownSyntaxRendering(page, title);
		});

		test('Verify Mode Content Sync', async function ({ app, page, keyboard }) {
			await verifyModeContentSync(app);
			await test.step('Clean up file edits', async () => {
				try {
					await page.getByText('YOLO').dblclick();
					await keyboard.press('Backspace');
					await keyboard.press('Backspace');
					await changeEditMode(page, 'Visual');
				} catch (error) {
					// ignore
				}
			});
		});

		if (filePath.match(/\.(qmd|rmd)$/)) {
			test('Verify Code Block Execution', async function ({ app, page }) {
				await changeEditMode(page, 'Visual');
				await verifyCodeExecution(app);
			});
		}

		test('Verify Outline', async function ({ }) {
			// Add outline test logic if needed
		});
	});
}


// Helper functions

async function verifyMarkdownSyntaxRendering(page: Page, title: string) {
	await test.step('Verify markdown syntax rendering', async () => {
		const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

		// verify heading
		await expect(viewerFrame.getByRole('heading', { name: `${title} Testing Document` })).toBeVisible();

		// verify bold text
		const boldElement = viewerFrame.getByText('bold');
		await expect(boldElement).toHaveCSS('font-weight', '700');

		// verify italic text
		const italicElement = viewerFrame.getByText('italic');
		const fontStyle = await italicElement.evaluate(el => window.getComputedStyle(el).fontStyle);
		expect(fontStyle).toBe('italic');

		// verify hyperlink
		const hyperlinkElement = viewerFrame.getByText('link');
		await expect(hyperlinkElement).toHaveAttribute('href', '#0');

		// verify bullet list: top-level bullet list is present
		const bulletList = viewerFrame.locator('ul.pm-bullet-list').nth(0);
		await expect(bulletList).toBeVisible();
		await expect(bulletList.locator('> li')).toHaveCount(2); // Ensures only top-level items are counted

		// verify bullet list: "Item 2" contains a nested bullet list
		const nestedList = viewerFrame.locator('ul.pm-bullet-list > li:nth-of-type(2) ul.pm-bullet-list');
		await expect(nestedList).toBeVisible();
		await expect(nestedList.locator('> li')).toHaveCount(2); // Only count direct children of nested list

		// verify bullet: bullets are visible via CSS
		const listStyle = await bulletList.evaluate(el => window.getComputedStyle(el).listStyleType);
		expect(listStyle).not.toBe('none');

		// verify bullet list: list item text at both levels
		await expect(viewerFrame.locator('ul.pm-bullet-list > li')).toContainText(['Item 1', 'Item 2']); // Top-level items
		await expect(nestedList.locator('> li')).toContainText(['Sub-item 2.1', 'Sub-item 2.2']); // Nested items
	});
}

async function changeEditMode(page: Page, mode: 'Source' | 'Visual') {
	await test.step(`Change edit mode to ${mode}`, async () => {
		const keyboard = new Keyboard(page);

		try {
			// if we are in mode 'source' we should see line numbers
			await expect(page.locator('div.line-numbers').first()).toBeVisible({ timeout: 2500 });
			if (mode === 'Visual') {
				await keyboard.hotKeys(Hotkeys.VISUAL_MODE);
			}
		} catch (error) {
			// only get here if we are currently in visual mode
			if (mode === 'Source') {
				await keyboard.hotKeys(Hotkeys.VISUAL_MODE);
			}
		}

		const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

		// validate we are in correct mode
		mode === 'Source'
			? await expect(page.locator('div.line-numbers').first()).toBeVisible()
			: await expect(viewerFrame.getByRole('button', { name: /Show Outline/ })).toBeVisible();
	});
}

async function verifyModeContentSync(app: Application): Promise<void> {
	const page = app.code.driver.page;
	const testText = 'YOLO ';
	const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

	await test.step('Edit content in source mode', async () => {
		await changeEditMode(page, 'Source');
		await page.getByText("synchronization").click();
		await page.keyboard.type(testText);
	});

	await test.step('Verify content in visual mode', async () => {
		await changeEditMode(page, 'Visual');
		await expect(viewerFrame.getByText(testText)).toBeVisible();
	});

	await test.step('Verify content in source mode', async () => {
		await changeEditMode(page, 'Source');
		await expect(page.getByText(testText)).toBeVisible();
	});
}

async function verifyCodeExecution(app: Application) {
	const page = app.code.driver.page;
	const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

	await test.step('Verify Python run cell button', async () => {
		await viewerFrame.getByText('{python}# A simple Python').click();
		await expect(viewerFrame.getByTitle('Run Cell', { exact: true })).toBeVisible();
	});

	await test.step('Verify R cell code execution', async () => {
		await viewerFrame.getByText('{r}# A simple R').click();
		await viewerFrame.getByTitle('Run Cell', { exact: true }).click();
		await app.workbench.plots.waitForCurrentPlot();
	});
}

// 	await verifyYamlRendering();
// 	await verifyEquationRendering();
