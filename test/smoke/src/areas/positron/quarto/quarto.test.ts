/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, QuickAccess, QuickInput, Terminal } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
const path = require('path');


export function setup(logger: Logger) {
	describe('Quarto', () => {

		installAllHandlers(logger);

		let terminal: Terminal;
		let quickAccess: QuickAccess;
		let quickInput: QuickInput;

		before(async function () {
			const app = this.app as Application;
			terminal = app.workbench.terminal;
			quickAccess = app.workbench.quickaccess;
			quickInput = app.workbench.quickinput;
			await quickAccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		});

		it('should render qmd to html', async function () {
			await quickAccess.runCommand('quarto.render.document', { keepOpen: true });
			await quickInput.selectQuickInputElementContaining('html');
			await terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('Output created: quarto_basic.html')));
		});

		it('should render qmd to docx', async function () {
			await quickAccess.runCommand('quarto.render.document', { keepOpen: true });
			await quickInput.selectQuickInputElementContaining('docx');
			await terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('Output created: quarto_basic.docx')));
		});
	});
}


