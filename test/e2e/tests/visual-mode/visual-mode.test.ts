/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { Application } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Visual Mode: Quarto File', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR]
}, () => {
	test.beforeAll(async function ({ }, testInfo) {
		// This test can only run in the browser due to native menu interactions
		if (testInfo.project.name !== 'e2e-browser') {
			test.skip();
		}
	});

	test.afterEach(async function ({ app, hotKeys }) {
		// close all editors
		await hotKeys.press('Cmd+K');
		await hotKeys.press('Cmd+W');
	});

	// test('Markdown', { tag: [tags.HTML] }, async function ({ app, page, openFile }) {
	// 	await openFile('workspaces/dash-py-example/data/OilandGasMetadata.html');

	// 	await verifyMarkdownSyntaxRendering();
	// 	await verifyModeContentSync();
	// 	await verifyCodeBlockRendering();
	// });

	// test('R Markdown Document', {
	// 	tag: [tags.R_MARKDOWN]
	// }, async function ({ app, openFile }) {
	// 	await openFile('workspaces/basic-rmd/basic-rmd.rmd');

	// 	await verifyMarkdownSyntaxRendering();
	// 	await verifyModeContentSync();
	// 	await verifyCodeBlockRendering();
	// 	await verifyYamlRendering();
	// 	await verifyEquationRendering();
	// 	await verifyCodeExecution();
	// });

	test.beforeAll(async function ({ openFile, runCommand, page }) {
		await openFile('workspaces/visual-mode/visual-mode.qmd', false);
		await runCommand('edit in visual mode');
		await page.getByText('Use Visual Mode').click();
	});

	// Quarto:
	// 		// await verifyYamlRendering(app);
	// await verifyEquationRendering(app);
	// await verifyCodeExecution(app);

	test('Verify Markdown Syntax Rendering', {
		tag: [tags.QUARTO, tags.WEB]
	}, async function ({ page, app }) {
		await verifyMarkdownSyntaxRendering(page);
	});

	test('Verify Mode Content Sync', {
		tag: [tags.QUARTO, tags.WEB]
	}, async function ({ app, page }) {
		await changeEditMode(app, 'Visual');
		await verifyModeContentSync(app);
		try {
			await page.getByText('YOLO').dblclick();
			await page.keyboard.press('Backspace');
			await page.keyboard.press('Backspace');
			await changeEditMode(app, 'Visual');
		} catch (error) {
			// ignore
		}
	});

	test('Verify Code Block Execution', {
		tag: [tags.QUARTO, tags.WEB]
	}, async function ({ app }) {
		await changeEditMode(app, 'Visual');
		await verifyCodeExecution(app);
	});

	test('Verify Outline', {
		tag: [tags.QUARTO, tags.WEB]
	}, async function ({ }) {
	});
});


// Helper functions

async function verifyMarkdownSyntaxRendering(page: Page) {
	await test.step('verify markdown syntax rendering', async () => {
		const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

		// verify heading
		await expect(viewerFrame.getByRole('heading', { name: 'Quarto Markdown Testing Document' })).toBeVisible();

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

async function changeEditMode(app: Application, mode: 'Source' | 'Visual') {
	await test.step(`change edit mode to ${mode}`, async () => {
		const page = app.code.driver.page;

		try {
			// if we are in mode 'source' we should see line numbers
			await expect(page.locator('div.line-numbers').first()).toBeVisible({ timeout: 2500 });
			if (mode === 'Visual') {
				await app.workbench.hotKeys.press('Cmd+Shift+F4');
			}
		} catch (error) {
			// only get here if we are currently in visual mode
			if (mode === 'Source') {
				await app.workbench.hotKeys.press('Cmd+Shift+F4');
			}
		}

		const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

		// validate we are in correct mode
		mode === 'Source'
			? await expect(page.locator('div.line-numbers').first()).toBeVisible()
			: await expect(viewerFrame.getByRole('button', { name: 'Show Outline (⌃⌥O)' })).toBeVisible();
	});
}

async function verifyModeContentSync(app: Application): Promise<void> {
	const page = app.code.driver.page;
	const testText = 'YOLO ';
	const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');
	// Edit Content in Source Mode
	await changeEditMode(app, 'Source');
	await page.getByText('"Test Title"').click();
	await page.keyboard.type(testText);

	// Verify content in Visual Mode
	await changeEditMode(app, 'Visual');
	await expect(viewerFrame.getByText(`Test ${testText} Title`)).toBeVisible();

	// Verify content in Source Mode
	await changeEditMode(app, 'Source');
	await expect(page.getByText(`Test ${testText} Title`)).toBeVisible();
}

async function verifyCodeExecution(app: Application) {
	const page = app.code.driver.page;
	const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');

	await viewerFrame.getByText('{python}# A simple Python').click();
	await viewerFrame.getByTitle('Run Cell', { exact: true }).click();
	await expect(page.getByText('Hello, Python!', { exact: true })).toBeVisible();

	await viewerFrame.getByText('{r}# A simple R').click();
	await viewerFrame.getByTitle('Run Cell', { exact: true }).click();
	await app.workbench.plots.waitForCurrentPlot();
}
