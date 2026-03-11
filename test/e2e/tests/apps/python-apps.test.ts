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
		tags: [tags.WORKBENCH], // this test is flaky on Windows, so not tagged
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
		await app.workbench.terminal.clickTerminalTab(); // ensure we are in the terminal tab for cleanup
		await app.workbench.terminal.sendKeysToTerminal('Control+C');
		await app.workbench.viewer.clearViewer();
	});

	test('Python - Verify Basic Dash App', { tag: [tags.WIN, tags.WORKBENCH] }, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'dash_example', 'dash_example.py'));
		await app.workbench.editor.pressPlay();

		await expect(
			app.web
				? viewer.viewerFrame.frameLocator('iframe').getByText('Hello World')
				: viewer.getViewerFrame().getByText('Hello World')
		).toBeVisible({ timeout: 30000 });

		await test.step('Verify Clear Current URL button clears Viewer', async () => {
			// Click the Viewer tab to ensure buttons are visible
			await app.code.driver.page.getByRole('tab', { name: 'Viewer' }).locator('a').click();

			// Click the clear button
			const clearButton = viewer.fullApp.getByLabel(/Clear the current URL/);
			await expect(clearButton).toBeVisible({ timeout: 5000 });
			await clearButton.click();

			// Verify the iframe is removed
			await expect(async () => {
				const iframeLocator = app.web
					? viewer.viewerFrame.locator('iframe')
					: viewer.getViewerFrame().locator('iframe');
				const count = await iframeLocator.count();
				expect(count).toBe(0);
			}).toPass({ timeout: 10000 });
		});

		await test.step('Verify app can be opened in editor', async () => {
			// Re-run the app since we cleared it
			await app.workbench.editor.pressPlay();
			await expect(
				app.web
					? viewer.viewerFrame.frameLocator('iframe').getByText('Hello World')
					: viewer.getViewerFrame().getByText('Hello World')
			).toBeVisible({ timeout: 30000 });

			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorFrameLocator = app.workbench.editor.getEditorViewerFrame();

			await expect(
				app.web
					? editorFrameLocator.frameLocator('iframe').getByText('Hello World')
					: editorFrameLocator.getByText('Hello World')
			).toBeVisible({ timeout: 30000 });
		});
	});

	test('Python - Verify Basic FastAPI App', {
		tag: [tags.WIN]
	}, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'fastapi_example', 'fastapi_example.py'));
		await app.workbench.editor.pressPlay();

		await expect(
			app.web
				? viewer.viewerFrame.frameLocator('iframe').getByText('FastAPI')
				: viewer.getViewerFrame().getByText('FastAPI')
		).toBeVisible({ timeout: 30000 });

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorHeaderLocator = app.web
				? app.workbench.editor.viewerFrame.frameLocator('iframe').getByRole('heading', { name: 'FastAPI' })
				: app.workbench.editor.viewerFrame.getByRole('heading', { name: 'FastAPI' });

			await expect(editorHeaderLocator).toBeVisible({ timeout: 30000 });
		});
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

			// Press play and verify the content is visible in the viewer frame
			await editor.pressPlay();
			await viewer.expectContentVisible(appTest.locator, {
				onRetry: async () => {
					await terminal.clickTerminalTab();
					await terminal.sendKeysToTerminal('Control+C');
					await editor.pressPlay();
				}
			});

			// Click the "Open in Editor" button and verify the content is visible in the editor viewer frame
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
