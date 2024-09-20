/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, Workbench } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';
const path = require('path');


export function setup(logger: Logger) {
	describe('Quarto #pr', () => {

		installAllHandlers(logger);

		let wb: Workbench;
		let app: Application;

		before(async function () {
			app = this.app as Application;
			wb = app.workbench;

			await wb.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		it('should be able to render html', async function () {
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('html');
			await wb.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Output created: quarto_basic.html')));
		});

		it('should be able to render docx ', async function () {
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('docx');
			await wb.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Output created: quarto_basic.docx')));
		});

		it('should be able to render pdf (LaTeX)', async function () {
			// ensure tinytex is installed
			// await wb.positronTerminal.clickTerminalTab();
			// await wb.terminal.runCommandInTerminal('quarto install tinytex');
			// await wb.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Installation successful') || line.includes('tinytex is already installed')));
			// await app.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+k' : 'ctrl+k');

			// render pdf
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('pdf');

			await wb.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('Output created: quarto_basic.pdf')));
		});

		it('should be able to generate preview', async function () {
			await wb.quickaccess.runCommand('quarto.preview', { keepOpen: true });
			const viewerFrame = wb.positronViewer.getViewerFrame('//iframe');
			expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
		});
	});
}


