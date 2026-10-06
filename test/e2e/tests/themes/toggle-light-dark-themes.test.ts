/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Color Themes', { tag: [tags.THEMES, tags.WEB, tags.WIN] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'window.autoDetectColorScheme': false,
			'workbench.preferredDarkColorTheme': 'Dark Modern',
			'workbench.preferredLightColorTheme': 'Default Positron Light',
			'workbench.colorTheme': 'Default Positron Light',
		}, { keepOpen: false });
	});

	test('Toggle between Light/Dark Themes round-trips through a hidden preferred theme', async function ({ app, page }) {
		// The workbench carries the active theme's ID as class tokens. Match the
		// exact theme, not only its type, so any other dark theme cannot pass.
		const positronLightClass = /(^|\s)vscode-theme-defaults-themes-positron_light-json(\s|$)/;
		const darkModernClass = /(^|\s)vscode-theme-defaults-themes-dark_modern-json(\s|$)/;
		const workbench = page.locator('.monaco-workbench');
		await expect(workbench).toHaveClass(positronLightClass);

		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		await expect(workbench).toHaveClass(darkModernClass);

		await app.workbench.quickaccess.runCommand('workbench.action.toggleLightDarkThemes');
		await expect(workbench).toHaveClass(positronLightClass);
	});
});
