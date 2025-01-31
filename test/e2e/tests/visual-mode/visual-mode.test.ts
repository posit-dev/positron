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

test.describe('Visual Mode', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR]
}, () => {
	test.beforeAll(async function ({ }, testInfo) {
		// This test can only run in the browser due to native menu interactions
		if (testInfo.project.name !== 'e2e-browser') {
			test.skip();
		}
	});

	test.afterEach(async function ({ app, hotKeys }) {
		const page = app.code.driver.page;
		try {
			await page.getByText('YOLO').dblclick();
			await page.keyboard.press('Backspace');
			await page.keyboard.press('Backspace');
			await changeEditMode(app, 'Visual');
		} catch (error) {
			// ignore
		}

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

	test('Quarto Markdown Document', {
		tag: [tags.QUARTO, tags.WEB]
	}, async function ({ app, page, openFile, runCommand }) {
		// open file and accent visual mode via native dialog
		await openFile('workspaces/visual-mode/visual-mode.qmd', false);
		await runCommand('edit in visual mode');
		await page.getByText('Use Visual Mode').click();

		// verifications
		await verifyMarkdownSyntaxRendering(page);
		await verifyModeContentSync(app, runCommand);
		// await verifyCodeBlockRendering(app);
		// await verifyYamlRendering(app);
		// await verifyEquationRendering(app);
		// await verifyCodeExecution(app);
		// await verifyOutline(app);

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
		await app.workbench.hotKeys.press('Cmd+Shift+F4');

		if (mode === 'Source') {
			await expect(page.locator('div.line-numbers').first()).toBeVisible();
		}
		else {
			const viewerFrame = page.frameLocator('.webview').frameLocator('#active-frame');
			await expect(viewerFrame.getByRole('button', { name: 'Show Outline (⌃⌥O)' })).toBeVisible();
		}
	});
}

async function verifyModeContentSync(app: Application, runCommand: (command: string) => Promise<void>) {
	const page = app.code.driver.page;
	await test.step('verify mode content sync', async () => {
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
	});
}
