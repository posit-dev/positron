/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, TerminalCommandId, Workbench } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';
const path = require('path');
const fs = require('fs-extra');

export function setup(logger: Logger) {
	describe('Quarto #pr', () => {

		installAllHandlers(logger);

		let wb: Workbench;
		let app: Application;

		before(async function () {
			app = this.app as Application;
			wb = app.workbench;

			// ensure tinytex is installed (needed for LaTeX rendering)
			await wb.positronTerminal.clickTerminalTab();
			await wb.terminal.runCommandInTerminal('quarto install tinytex');
			await wb.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Installation successful') || line.includes('tinytex is already installed')));
			await app.workbench.terminal.runCommand(TerminalCommandId.KillAll);

			// open quarto_basic file
			await wb.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		afterEach(async function () {
			await deleteGeneratedFiles(app);
		});

		it('should be able to render html', async function () {
			// render html
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('html');

			// verify file exists
			await verifyTextInTerminal(app, 'html');
			expect(await verifyFileExists(app, 'quarto_basic.html')).toBe(true);
		});

		it('should be able to render docx ', async function () {
			// render docx
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('docx');

			// verify file exists
			await verifyTextInTerminal(app, 'docx');
			expect(await verifyFileExists(app, 'quarto_basic.docx')).toBe(true);
		});

		it('should be able to render pdf (LaTeX)', async function () {
			// render LaTeX pdf
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('pdf');

			// verify file exists
			await verifyTextInTerminal(app, 'pdf');
			expect(await verifyFileExists(app, 'quarto_basic.pdf')).toBe(true);
		});

		it('should be able to render pdf (typst)', async function () {
			// render typst pdf
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('typst');

			// verify file exists
			await verifyTextInTerminal(app, 'pdf');
			expect(await verifyFileExists(app, 'quarto_basic.pdf')).toBe(true);
		});

		it('should be able to generate preview', async function () {
			// generate preview
			await wb.quickaccess.runCommand('quarto.preview', { keepOpen: true });
			const viewerFrame = wb.positronViewer.getViewerFrame('//iframe');

			// verify preview displays
			expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
		});
	});
}


const verifyFileExists = (app: Application, file: String) => {
	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
	return fs.pathExists(filePath);
};

const verifyTextInTerminal = async (app: Application, fileExtension: string) => {
	await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes(`Output created: quarto_basic.${fileExtension}`)));
};

const deleteGeneratedFiles = async (app: Application) => {
	if (await verifyFileExists(app, 'quarto_basic.pdf')) {
		await fs.remove(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.pdf'));
	}
	if (await verifyFileExists(app, 'quarto_basic.html')) {
		await fs.remove(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.html'));
	}
	if (await verifyFileExists(app, 'quarto_basic.docx')) {
		await fs.remove(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.docx'));
	}
};
