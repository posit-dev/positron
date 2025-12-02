/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Python Applications', {
	tag: [tags.CRITICAL, tags.APPS, tags.VIEWER, tags.EDITOR, tags.WEB]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.focusConsole();
		await app.workbench.terminal.clickTerminalTab(); // ensure we are in the terminal tab for cleanup
		await app.workbench.terminal.sendKeysToTerminal('Control+C');
		await app.workbench.viewer.clearViewer();
	});

	test('Python - Verify Basic Dash App', { tag: [tags.WIN] }, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'dash_example', 'dash_example.py'));
		await app.workbench.editor.pressPlay();

		await expect(
			app.web
				? viewer.viewerFrame.frameLocator('iframe').getByText('Hello World')
				: viewer.getViewerFrame().getByText('Hello World')
		).toBeVisible({ timeout: 30000 });

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorFrameLocator = app.workbench.editor.getEditorViewerFrame();

			await expect(
				app.web
					? editorFrameLocator.frameLocator('iframe').getByText('Hello World')
					: editorFrameLocator.getByText('Hello World')
			).toBeVisible({ timeout: 30000 });
		});

		await test.step('Verify Clear Current URL clears Viewer', async () => {
			await app.workbench.quickaccess.runCommand('positron.preview.clear');

			await expect(async () => {
				const iframeLocator = app.web
					? viewer.viewerFrame.locator('iframe')
					: viewer.getViewerFrame().locator('iframe');
				const count = await iframeLocator.count();
				expect(count).toBe(0);
			}).toPass({ timeout: 30000 });
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
	});

	test('Python - Verify Basic Gradio App', {
		tag: [tags.WIN],
	}, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'gradio_example', 'gradio_example.py'));
		await app.workbench.editor.pressPlay();

		await expect(
			app.web
				? viewer.viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Submit' })
				: viewer.getViewerFrame().getByRole('button', { name: 'Submit' })
		).toBeVisible({ timeout: 45000 });

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorFrameLocator = app.workbench.editor.getEditorViewerFrame();

			await expect(
				app.web
					? editorFrameLocator.frameLocator('iframe').getByRole('button', { name: 'Submit' })
					: editorFrameLocator.getByRole('button', { name: 'Submit' })
			).toBeVisible({ timeout: 30000 });
		});

	});

	test('Python - Verify Basic Streamlit App', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
		await app.workbench.editor.pressPlay();

		const viewerFrame = viewer.getViewerFrame();

		await expect(async () => {
			const headerLocator = app.web
				? viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Deploy' })
				: viewerFrame.getByRole('button', { name: 'Deploy' });

			await expect(headerLocator).toBeVisible({ timeout: 30000 });
		}).toPass({ timeout: 60000 });

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editor = app.workbench.editor;
			const editorFrame = editor.getEditorViewerFrame();

			const headerLocator = app.web
				? editorFrame.frameLocator('iframe').getByRole('button', { name: 'Deploy' })
				: editorFrame.getByRole('button', { name: 'Deploy' });

			await expect(headerLocator).toBeVisible({ timeout: 30000 });
		});
	});

	test('Python - Verify Basic Flask App', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, openFile, python }) {
		const viewer = app.workbench.viewer;

		await openFile(join('workspaces', 'python_apps', 'flask_example', '__init__.py'));

		await app.workbench.editor.pressPlay();
		const viewerFrame = viewer.getViewerFrame();
		const loginLocator = app.web
			? viewerFrame.frameLocator('iframe').getByText('Log In')
			: viewerFrame.getByText('Log In');

		await expect(loginLocator).toBeVisible({ timeout: 60000 });

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editor = app.workbench.editor;
			const editorFrame = editor.getEditorViewerFrame();

			const loginLocator = app.web
				? editorFrame.frameLocator('iframe').getByText('Log In')
				: editorFrame.getByText('Log In');

			await expect(loginLocator).toBeVisible({ timeout: 30000 });
		});
	});

	test('Python - Verify Viewer interrupt button for Streamlit app', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, openFile, page, python }) {
		const viewer = app.workbench.viewer;
		const interruptButton = page.locator('.positron-action-bar').getByRole('button', { name: 'Interrupt execution' });

		await test.step('Launch Streamlit app', async () => {
			await openFile(join('workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
			await app.workbench.editor.pressPlay();

			const viewerFrame = viewer.getViewerFrame();

			await expect(async () => {
				const headerLocator = app.web
					? viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Deploy' })
					: viewerFrame.getByRole('button', { name: 'Deploy' });

				await expect(headerLocator).toBeVisible({ timeout: 30000 });
			}).toPass({ timeout: 60000 });
		});

		await test.step('Verify interrupt button is visible', async () => {
			await expect(interruptButton).toBeVisible({ timeout: 10000 });
		});

		await test.step('Click interrupt button and verify it disappears', async () => {
			await interruptButton.click();

			// Button should disappear immediately after clicking
			await expect(interruptButton).not.toBeVisible({ timeout: 5000 });
		});
	});
});

