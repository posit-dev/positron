/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Python Applications', { tag: ['@pr'] }, () => {
	test.describe('Python Applications', () => {
		test.afterEach(async function ({ app }) {
			await app.workbench.quickaccess.runCommand('workbench.action.terminal.focus');
			await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');
			// unreliable on ubuntu:
			// await this.app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes('^C')));
			await app.workbench.positronViewer.clearViewer();
		});

		test('Python - Verify Basic Dash App [C903305]', async function ({ app, python }) {
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'dash_example', 'dash_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(viewer.getViewerFrame().getByText('Hello World')).toBeVisible({ timeout: 30000 });
		});

		// FastAPI is not working as expected on Ubuntu
		test.skip('Python - Verify Basic FastAPI App [C903306]', {
			annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/4949' }]
		}, async function ({ app, python }) {
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'fastapi_example', 'fastapi_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(viewer.getViewerFrame().getByText('FastAPI')).toBeVisible({ timeout: 30000 });
		});

		test('Python - Verify Basic Gradio App [C903307]', async function ({ app, python }) {
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'gradio_example', 'gradio_example.py'));
			await app.workbench.positronEditor.pressPlay();
			await expect(viewer.getViewerFrame().getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 30000 });
		});

		test('Python - Verify Basic Streamlit App [C903308]', { tag: ['@web'] }, async function ({ app, python }) {
			const viewer = app.workbench.positronViewer;

			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
			await app.workbench.positronEditor.pressPlay();

			await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
			const viewerFrame = viewer.getViewerFrame();
			const headerLocator = app.web
				? viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Deploy' })
				: viewerFrame.getByRole('button', { name: 'Deploy' });

			await expect(async () => {
				await expect(headerLocator).toBeVisible({ timeout: 30000 });
			}).toPass({ timeout: 60000 });

			await app.workbench.positronLayouts.enterLayout('stacked');
		});
	});
});

