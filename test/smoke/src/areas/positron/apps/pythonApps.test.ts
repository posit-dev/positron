/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { join } from 'path';

describe('Python Applications #pr', () => {
	setupAndStartApp();

	describe('Python Applications', () => {
		before(async function () {
			await this.app.workbench.positronConsole.waitForReadyOrNoInterpreter();

			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		afterEach(async function () {
			await this.app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

			// unreliable on ubuntu:
			// await this.app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('^C')));

			await this.app.workbench.positronViewer.refreshViewer();
		});

		it('Python - Verify Basic Dash App [C903305]', async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'dash_example', 'dash_example.py'));

			await app.workbench.positronEditor.pressPlay();

			const headerLocator = app.workbench.positronViewer.getViewerLocator('#_dash-app-content');

			await expect(headerLocator).toHaveText('Hello World', { timeout: 45000 });

		});

		// https://github.com/posit-dev/positron/issues/4949
		// FastAPI is not working as expected on Ubuntu
		it.skip('Python - Verify Basic FastAPI App [C903306]', async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'fastapi_example', 'fastapi_example.py'));

			await app.workbench.positronEditor.pressPlay();

			const headerLocator = app.workbench.positronViewer.getViewerLocator('h2.title');

			await expect(headerLocator).toContainText('FastAPI', { timeout: 45000 });

		});

		it('Python - Verify Basic Gradio App [C903307]', async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'gradio_example', 'gradio_example.py'));

			await app.workbench.positronEditor.pressPlay();

			const headerLocator = app.workbench.positronViewer.getViewerLocator('button.primary');

			await expect(headerLocator).toHaveText('Submit', { timeout: 45000 });

		});

		it('Python - Verify Basic Streamlit App [C903308] #web', async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));

			await app.workbench.positronEditor.pressPlay();

			const headerLocator = app.workbench.positronViewer.getViewerLocator('div.stAppDeployButton', this.app.web);

			await expect(headerLocator).toHaveText('Deploy', { timeout: 45000 });

		});
	});
});

