/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import { _electron, expect } from '@playwright/test';

import path = require('path');
import { test } from './test.setup';
import { Application } from '../../../automation';
const fs = require('fs-extra');



test.describe('poc suite', () => {
	test.beforeEach(async ({ app }) => {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
	});

	test('should be able to generate preview [C842891]', async function ({ app, page }) {
		await app.workbench.quickaccess.runCommand('quarto.preview', { keepOpen: true });

		// using driver
		const viewerFrame = app.workbench.positronViewer.getViewerFrame('//iframe');
		expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');

		// not using driver
		await expect(page.locator('iframe')
			.contentFrame()
			.locator('iframe[title="Quarto Preview"]')
			.contentFrame()
			.locator('iframe')
			.contentFrame()
			.getByRole('heading'))
			.toHaveText('Diamond sizes');
	});

	test('poc test 1', async ({ app }) => {
		// await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await app.code.driver.takeScreenshot('screen 1');
		await renderQuartoDocument(app, 'html');
		// expect(1).toBe(2);
	});

	test('poc test 2', async ({ app }) => {
		// await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await app.code.driver.takeScreenshot('screen 2');
	});
});

const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
	await app.workbench.quickinput.selectQuickInputElementContaining(fileExtension);
};

const verifyDocumentExists = async (app: Application, fileExtension: string) => {
	await expect(async () => {
		await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes(`Output created: quarto_basic.${fileExtension}`)));
		expect(await fileExists(app, `quarto_basic.${fileExtension}`)).toBe(true);
	}).toPass();
};

const fileExists = (app: Application, file: string) => {
	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
	return fs.pathExists(filePath);
};
