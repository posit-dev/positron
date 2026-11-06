/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

const PYTHON_FILE = 'workspaces/long-running-loop/loop.py';
const REMOTE_RESOURCE_URL_FRAGMENT = 'vscode-remote-resource';
const THEME_CLASS = /vscode-theme-[\w-]+/;

test.use({
	suiteId: __filename
});

// Web-only: Electron loads extension resources over vscode-file:, so only the
// browser client can build a server path the server does not serve (#17170).
test.describe('Web: extension resources', {
	tag: [tags.THEMES, tags.WEB, tags.WEB_ONLY, tags.WORKBENCH, tags.JUPYTER]
}, () => {

	test.afterAll(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Themes, grammars and file icons are served and highlight an open file', async function ({ app, page, openFile, hotKeys }) {
		const failedResources: string[] = [];
		page.on('response', response => {
			if (response.status() >= 400 && response.url().includes(REMOTE_RESOURCE_URL_FRAGMENT)) {
				failedResources.push(`${response.status()} ${response.url()}`);
			}
		});

		await test.step('Reload so the startup theme and icon theme requests are observed', async () => {
			await hotKeys.reloadWindowWith(() => page.reload());
		});

		await openFile(PYTHON_FILE);

		const workbench = page.locator('.monaco-workbench');
		const initialTheme = (await workbench.getAttribute('class'))?.match(THEME_CLASS)?.[0];
		expect(initialTheme).toBeDefined();
		const initialThemeClass = new RegExp(`(^|\\s)${initialTheme}(\\s|$)`);

		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		// Soft so a theme that failed to load still reports the failed requests below.
		await expect.soft(workbench).not.toHaveClass(initialThemeClass);

		expect(failedResources, `Extension resource requests failed:\n${failedResources.join('\n')}`).toEqual([]);

		await expect.poll(() => app.workbench.editor.getTokenClasses('loop.py'), {
			message: 'Expected more than one token class; the Python grammar did not load'
		}).not.toHaveLength(1);

		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		await expect(workbench).toHaveClass(initialThemeClass);
	});
});
