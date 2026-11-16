/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

const PYTHON_FILE = 'workspaces/long-running-loop/loop.py';
const REMOTE_RESOURCE_URL_FRAGMENT = 'vscode-remote-resource';
const THEME_SETTINGS = {
	'window.autoDetectColorScheme': false,
	'workbench.preferredDarkColorTheme': 'Default Positron Dark',
	'workbench.preferredLightColorTheme': 'Default Positron Light',
	'workbench.colorTheme': 'Default Positron Light',
};
const positronLightClass = /(^|\s)vscode-theme-defaults-themes-positron_light-json(\s|$)/;
const positronDarkClass = /(^|\s)vscode-theme-defaults-themes-positron_dark-json(\s|$)/;

test.use({
	suiteId: __filename
});

// Web-only: Electron loads extension resources over vscode-file:, so only the
// browser client can build a server path the server does not serve (#17170).
test.describe('Web: extension resources', {
	tag: [tags.THEMES, tags.WEB, tags.WEB_ONLY, tags.WORKBENCH, tags.JUPYTER]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set(THEME_SETTINGS);
	});

	test.afterAll(async function ({ settings, hotKeys }) {
		await hotKeys.closeAllEditors();
		await settings.remove(Object.keys(THEME_SETTINGS));
	});

	test('Themes, grammars and file icons are served and highlight an open file', async function ({ app, page, openFile, hotKeys }) {
		const failedResources: string[] = [];
		page.on('response', response => {
			if (response.status() >= 400 && response.url().includes(REMOTE_RESOURCE_URL_FRAGMENT)) {
				failedResources.push(`${response.status()} ${response.url()}`);
			}
		});

		await test.step('Reload so the startup theme and icon theme requests are observed', async () => {
			await hotKeys.reloadWindowWith(async () => { await page.reload({ waitUntil: 'commit' }); });
		});

		await openFile(PYTHON_FILE);

		// Soft, so a theme or grammar that failed to load still reports the failed
		// requests at the end instead of stopping at the first symptom.
		const workbench = page.locator('.monaco-workbench');
		await expect.soft(workbench).toHaveClass(positronLightClass);
		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		await expect.soft(workbench).toHaveClass(positronDarkClass);

		await expect.soft.poll(async () => (await app.workbench.editor.getTokenClasses('loop.py')).length, {
			message: 'Expected more than one token class; the Python grammar did not load'
		}).toBeGreaterThan(1);

		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		await expect.soft(workbench).toHaveClass(positronLightClass);

		expect(failedResources, `Extension resource requests failed:\n${failedResources.join('\n')}`).toEqual([]);
	});
});
