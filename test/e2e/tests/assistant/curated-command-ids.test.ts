/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * Live-app guard for the command ids curated for the assistant command-access
 * experiment (the positron-commands skill / executeCommand tool allowlist in
 * posit-dev/assistant). The unit-level contract test checks the registries;
 * this exercises representative ids through the real command service the way
 * the assistant tool does, including the runtime-generated view focus command
 * that shipped a phantom id once already ('workbench.panel.positronVariables
 * .focus' never existed -- the Variables view overrides its focus command id).
 *
 * Deliberately deterministic: no assistant/model in the loop. Running a
 * curated id that no longer exists fails here because the command palette
 * cannot resolve it.
 */
test.describe('Assistant curated command ids', {
	tag: [tags.WEB, tags.WIN, tags.ASSISTANT]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Curated commands resolve and produce their effects in the live app', async function ({ app, page }) {
		const { quickaccess, variables } = app.workbench;

		await test.step('positronVariables.focus focuses the Variables pane', async () => {
			await quickaccess.runCommand('positronVariables.focus');
			await expect(variables.variablesPane).toBeVisible({ timeout: 15000 });
		});

		await test.step('positron.startupDiagnostics.show opens the diagnostics editor', async () => {
			await quickaccess.runCommand('positron.startupDiagnostics.show');
			await expect(page.getByRole('tab', { name: 'Runtime Startup Diagnostics' })).toBeVisible({ timeout: 15000 });
		});
	});
});
