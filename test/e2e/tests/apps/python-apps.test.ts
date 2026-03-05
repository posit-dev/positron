/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from '@playwright/test';
import { test, expect, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

interface AppTestConfig {
	name: string;
	tags: string[];
	filePath: string;
	locator: (frame: FrameLocator) => Locator;
}

const appTests: AppTestConfig[] = [
	{
		name: 'Dash',
		tags: [tags.WIN, tags.WORKBENCH],
		filePath: 'dash_example/dash_example.py',
		locator: frame => frame.getByText('Hello World'),
	},
	{
		name: 'FastAPI',
		tags: [tags.WIN],
		filePath: 'fastapi_example/fastapi_example.py',
		locator: frame => frame.getByText('FastAPI'),
	},
	{
		name: 'Gradio',
		tags: [tags.WIN],
		filePath: 'gradio_example/gradio_example.py',
		locator: frame => frame.getByRole('button', { name: 'Submit' }),
	},
	{
		name: 'Streamlit',
		tags: [tags.WEB, tags.WIN],
		filePath: 'streamlit_example/streamlit_example.py',
		locator: frame => frame.getByRole('button', { name: 'Deploy' }),
	},
	{
		name: 'Flask',
		tags: [tags.WEB, tags.WIN],
		filePath: 'flask_example/__init__.py',
		locator: frame => frame.getByText('Log In'),
	},
];

test.describe('Python Applications', {
	tag: [tags.CRITICAL, tags.APPS, tags.VIEWER, tags.EDITOR, tags.WEB]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		const { terminal, viewer } = app.workbench;

		await hotKeys.closeAllEditors();
		await hotKeys.focusConsole();
		await terminal.clickTerminalTab();
		await terminal.sendKeysToTerminal('Control+C');
		await viewer.clearViewer();
	});

	for (const appTest of appTests) {
		test(`Python - Verify Basic ${appTest.name} App`, {
			tag: appTest.tags
		}, async function ({ app, openFile, python }) {
			const { viewer, editor, terminal } = app.workbench;

			await openFile(join('workspaces', 'python_apps', appTest.filePath));

			// Press play and verify the content is visible in the viewer frame.
			// If content isn't visible (e.g., due to ERR_CONNECTION_RESET), interrupt
			// the server and restart it - the second attempt usually succeeds since
			// Python/packages are already loaded.
			await editor.pressPlay();
			await viewer.expectContentVisible(appTest.locator, {
				onRetry: async () => {
					await terminal.clickTerminalTab();
					await terminal.sendKeysToTerminal('Control+C');
					await editor.pressPlay();
				}
			});

			// Verify the content is also visible in the editor viewer frame
			await viewer.openViewerToEditor();
			await viewer.clearViewer();
			await editor.expectEditorViewerContentVisible(appTest.locator);
		});
	}

	test('Python - Verify Viewer interrupt button for Streamlit app', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, openFile, python }) {
		const { viewer, editor, terminal } = app.workbench;

		// Open the Streamlit app file and press play
		await openFile(join('workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
		await editor.pressPlay();
		await viewer.expectContentVisible(
			frame => frame.getByRole('button', { name: 'Deploy' }),
			{
				onRetry: async () => {
					await terminal.clickTerminalTab();
					await terminal.sendKeysToTerminal('Control+C');
					await editor.pressPlay();
				}
			}
		);

		await test.step('Verify interrupt button is visible', async () => {
			await expect(viewer.interruptButton).toBeVisible({ timeout: 10000 });
		});

		await test.step('Click interrupt button and verify it disappears', async () => {
			await viewer.interruptButton.click();
			await expect(viewer.interruptButton).not.toBeVisible({ timeout: 5000 });
		});
	});
});
