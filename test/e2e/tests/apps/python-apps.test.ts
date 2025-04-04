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
	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

		await app.workbench.quickaccess.runCommand('workbench.action.terminal.focus');
		await app.workbench.terminal.sendKeysToTerminal('Control+C');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		await app.workbench.viewer.clearViewer();
	});

	test('Python - Verify Basic Dash App', { tag: [tags.WIN] }, async function ({ app, python }) {
		const viewer = app.workbench.viewer;

		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'dash_example', 'dash_example.py'));
		await app.workbench.editor.pressPlay();

		if (!app.web) {
			await expect(viewer.getViewerFrame().getByText('Hello World')).toBeVisible({ timeout: 30000 });
		} else {
			await expect(viewer.viewerFrame.frameLocator('iframe').getByText('Hello World')).toBeVisible({ timeout: 30000 });
		}

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorFrameLocator = app.workbench.editor.getEditorViewerFrame();

			if (!app.web) {
				await expect(editorFrameLocator.getByText('Hello World')).toBeVisible({ timeout: 30000 });
			} else {
				await expect(editorFrameLocator.frameLocator('iframe').getByText('Hello World')).toBeVisible({ timeout: 30000 });
			}
		});
	});

	test('Python - Verify Basic FastAPI App', {
		tag: [tags.WIN]
	}, async function ({ app, python }) {
		const viewer = app.workbench.viewer;

		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'fastapi_example', 'fastapi_example.py'));
		await app.workbench.editor.pressPlay();
		if (!app.web) {
			await expect(viewer.getViewerFrame().getByText('FastAPI')).toBeVisible({ timeout: 30000 });
		} else {
			await expect(viewer.viewerFrame.frameLocator('iframe').getByText('FastAPI')).toBeVisible({ timeout: 30000 });
		}

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			let editorHeaderLocator;
			if (!app.web) {
				editorHeaderLocator = app.workbench.editor.getEditorViewerLocator('h2');
			} else {
				editorHeaderLocator = app.workbench.editor.viewerFrame.frameLocator('iframe').locator('h2');
			}

			await expect(editorHeaderLocator).toContainText('FastAPI', { timeout: 30000 });
		});
	});

	test('Python - Verify Basic Gradio App', {
		tag: [tags.WIN],
	}, async function ({ app, python }) {
		const viewer = app.workbench.viewer;

		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'gradio_example', 'gradio_example.py'));
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.editor.pressPlay();

		if (!app.web) {
			await expect(viewer.getViewerFrame().getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 45000 });
		} else {
			await expect(viewer.viewerFrame.frameLocator('iframe').getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 45000 });
		}

		await test.step('Verify app can be opened in editor', async () => {
			await app.workbench.viewer.openViewerToEditor();
			await app.workbench.viewer.clearViewer();

			const editorFrameLocator = app.workbench.editor.getEditorViewerFrame();

			if (!app.web) {
				await expect(editorFrameLocator.getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 30000 });
			} else {
				await expect(editorFrameLocator.frameLocator('iframe').getByRole('button', { name: 'Submit' })).toBeVisible({ timeout: 30000 });
			}
		});

		// await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');


	});

	test('Python - Verify Basic Streamlit App', {
		tag: [tags.WEB, tags.WIN]
	}, async function ({ app, python }) {
		const viewer = app.workbench.viewer;

		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'streamlit_example', 'streamlit_example.py'));
		await app.workbench.editor.pressPlay();

		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
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
	}, async function ({ app, python, page }) {
		const viewer = app.workbench.viewer;

		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'python_apps', 'flask_example', '__init__.py'));
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.editor.pressPlay();
		const viewerFrame = viewer.getViewerFrame();
		const loginLocator = app.web
			? viewerFrame.frameLocator('iframe').getByText('Log In')
			: viewerFrame.getByText('Log In');

		await expect(async () => {
			await expect(loginLocator).toBeVisible({ timeout: 30000 });
		}).toPass({ timeout: 60000 });

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

		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
	});
});

