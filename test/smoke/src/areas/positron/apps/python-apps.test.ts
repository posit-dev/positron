/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { join } from 'path';

describe('Python Applications #pr #win', () => {
	setupAndStartApp();

	describe('Python Applications', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		afterEach(async function () {
			await this.app.workbench.quickaccess.runCommand('workbench.action.terminal.focus');
			await this.app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

			// unreliable on ubuntu:
			// await this.app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('^C')));

			await this.app.workbench.positronViewer.refreshViewer();
		});

		it('Python - Verify Basic Dash App [C903305]', async function () {
			this.retries(1);
			const app = this.app as Application;
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'dash_example', 'dash_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(viewer.getViewerFrame().getByText('Hello World')).toBeVisible({ timeout: 30000 });
		});

		// https://github.com/posit-dev/positron/issues/4949
		// FastAPI is not working as expected on Ubuntu
		it.skip('Python - Verify Basic FastAPI App [C903306]', async function () {
			const app = this.app as Application;
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'fastapi_example', 'fastapi_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(viewer.getViewerFrame().getByText('FastAPI')).toBeVisible({ timeout: 30000 });
		});

		it('Python - Verify Basic Gradio App [C903307]', async function () {

			this.timeout(90000);

			const app = this.app as Application;
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'gradio_example', 'gradio_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(async () => {
				await expect(viewer.getViewerFrame().getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 30000 });
			}).toPass({ timeout: 60000 });
		});

		it('Python - Verify Basic Streamlit App [C903308] #web', async function () {

			this.timeout(90000);

			const app = this.app as Application;
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
			await app.workbench.positronEditor.pressPlay();

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
			const viewerFrame = viewer.getViewerFrame();
			const headerLocator = this.app.web
				? viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Deploy' })
				: viewerFrame.getByRole('button', { name: 'Deploy' });

			await expect(async () => {
				await expect(headerLocator).toBeVisible({ timeout: 30000 });
			}).toPass({ timeout: 60000 });

			await app.workbench.positronLayouts.enterLayout('stacked');
		});
	});
});

