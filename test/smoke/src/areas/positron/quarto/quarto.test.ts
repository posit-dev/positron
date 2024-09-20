/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Code, Logger, PositronViewer, QuickAccess, QuickInput, Terminal, Workbench } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';
const path = require('path');


export function setup(logger: Logger) {
	describe('Quarto', () => {

		installAllHandlers(logger);

		let wb: Workbench;

		before(async function () {
			const app = this.app as Application;
			wb = app.workbench;

			await wb.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		it('should be able to render html', async function () {
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('html');
			await wb.terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('Output created: quarto_basic.html')));

		});

		it('should be able to render docx ', async function () {
			await wb.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
			await wb.quickinput.selectQuickInputElementContaining('docx');
			await wb.terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('Output created: quarto_basic.docx')));
		});

		it('should be able to generate preview', async function () {
			await wb.quickaccess.runCommand('quarto.preview', { keepOpen: true });
			const viewerFrame = wb.positronViewer.getViewerFrame('//iframe');
			expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
		});
	});
}


