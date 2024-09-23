/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, TerminalCommandId } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';
const path = require('path');
const fs = require('fs-extra');

export function setup(logger: Logger) {
	describe('Quarto', () => {

		installAllHandlers(logger);

		let app: Application;

		before(async function () {
			app = this.app as Application;

			await installTinyTex(app);
			await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		afterEach(async function () {
			await deleteGeneratedFiles(app);
		});

		it('should be able to render html', async function () {
			await renderQuartoDocument(app, 'html');
			await verifyDocumentExists(app, 'html');
		});

		it('should be able to render docx ', async function () {
			await renderQuartoDocument(app, 'docx');
			await verifyDocumentExists(app, 'docx');
		});

		it('should be able to render pdf (LaTeX)', async function () {
			await renderQuartoDocument(app, 'pdf');
			await verifyDocumentExists(app, 'pdf');
		});

		it('should be able to render pdf (typst)', async function () {
			await renderQuartoDocument(app, 'typst');
			await verifyDocumentExists(app, 'pdf');
		});

		it('should be able to generate preview', async function () {
			await app.workbench.quickaccess.runCommand('quarto.preview', { keepOpen: true });
			const viewerFrame = app.workbench.positronViewer.getViewerFrame('//iframe');

			// verify preview displays
			expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
		});
	});
}

const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
	await app.workbench.quickinput.selectQuickInputElementContaining(fileExtension);
};

const verifyDocumentExists = async (app: Application, fileExtension: string) => {
	await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes(`Output created: quarto_basic.${fileExtension}`)));
	expect(await fileExists(app, `quarto_basic.${fileExtension}`)).toBe(true);
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

const installTinyTex = async (app: Application) => {
	// ensure tinytex is installed (needed for LaTeX rendering)
	await app.workbench.quickaccess.runCommand('terminal.focus.view');
	await app.workbench.terminal.runCommandInTerminal('quarto install tinytex');
	await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Installation successful') || line.includes('tinytex is already installed')));
	await app.workbench.terminal.runCommand(TerminalCommandId.KillAll);
};
