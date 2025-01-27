/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';
const path = require('path');
const fs = require('fs-extra');

let isWeb = false;

test.use({
	suiteId: __filename
});

test.describe('Quarto', { tag: [tags.WEB, tags.WIN, tags.QUARTO] }, () => {
	test.beforeAll(async function ({ app, browserName }) {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		isWeb = browserName === 'chromium';
	});

	test.afterEach(async function ({ app }) {
		await deleteGeneratedFiles(app);
	});

	test('should be able to render html', async function ({ app }) {
		await renderQuartoDocument(app, 'html');
		await verifyDocumentExists(app, 'html');
	});

	test('should be able to render docx ', async function ({ app }) {
		await renderQuartoDocument(app, 'docx');
		await verifyDocumentExists(app, 'docx');
	});

	test('should be able to render pdf (LaTeX)', async function ({ app }) {
		await renderQuartoDocument(app, 'pdf');
		await verifyDocumentExists(app, 'pdf');
	});

	test('should be able to render pdf (typst)', async function ({ app }) {
		await renderQuartoDocument(app, 'typst');
		await verifyDocumentExists(app, 'pdf');
	});

	test('should be able to generate preview', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('quarto.preview', { keepOpen: true });
		const viewerFrame = app.workbench.viewer.getViewerFrame().frameLocator('iframe');

		// verify preview displays
		await expect(viewerFrame.locator('h1')).toHaveText('Diamond sizes', { timeout: 30000 });
	});
});


const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await test.step(`render quarto document`, async () => {
		await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
		await app.workbench.quickInput.selectQuickInputElementContaining(fileExtension);
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
