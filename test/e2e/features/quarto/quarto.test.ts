/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../automation';
import { test, expect } from '../_test.setup';
const path = require('path');
const fs = require('fs-extra');

let isWeb = false;

test.use({
	suiteId: __filename
});

test.describe('Quarto', { tag: ['@web', '@quarto'] }, () => {
	test.beforeAll(async function ({ app, browserName }) {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		isWeb = browserName === 'chromium';
	});

	test.afterEach(async function ({ app }) {
		await deleteGeneratedFiles(app);
	});

	test('should be able to render html [C842847]', async function ({ app }) {
		await renderQuartoDocument(app, 'html');
		await verifyDocumentExists(app, 'html');
	});

	test('should be able to render docx [C842848]', async function ({ app }) {
		await renderQuartoDocument(app, 'docx');
		await verifyDocumentExists(app, 'docx');
	});

	test('should be able to render pdf (LaTeX) [C842890]', async function ({ app }) {
		await renderQuartoDocument(app, 'pdf');
		await verifyDocumentExists(app, 'pdf');
	});

	test('should be able to render pdf (typst) [C842889]', async function ({ app }) {
		await renderQuartoDocument(app, 'typst');
		await verifyDocumentExists(app, 'pdf');
	});

	test('should be able to generate preview [C842891]', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('quarto.preview', { keepOpen: true });
		const viewerFrame = app.workbench.positronViewer.getViewerFrame().frameLocator('iframe');

		// verify preview displays
		expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
	});
});


const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await test.step(`render quarto document`, async () => {
		await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
		await app.workbench.quickinput.selectQuickInputElementContaining(fileExtension);
	});
};

const verifyDocumentExists = async (app: Application, fileExtension: string) => {
	// there is a known issue with canvas interactions in webview
	if (!isWeb) { await expect(app.code.driver.page.getByText(`Output created: quarto_basic.${fileExtension}`)).toBeVisible({ timeout: 30000 }); }

	await expect(async () => {
		expect(await fileExists(app, `quarto_basic.${fileExtension}`)).toBe(true);
	}).toPass({ timeout: 15000 });
};

const deleteGeneratedFiles = async (app: Application) => {
	const files = ['quarto_basic.pdf', 'quarto_basic.html', 'quarto_basic.docx'];

	for (const file of files) {
		const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
		if (await fs.pathExists(filePath)) {
			await fs.remove(filePath);
		}
	}
};

const fileExists = (app: Application, file: String) => {
	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
	return fs.pathExists(filePath);
};
