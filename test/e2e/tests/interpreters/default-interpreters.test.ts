/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import path from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Default Interpreters', {
	tag: [tags.INTERPRETER]
}, () => {

	const homeDir = process.env.HOME || '';

	test.beforeAll(async function ({ app }) {

		const buildSet = !!process.env.BUILD;

		let vscodePath: string;
		let positronPath: string;
		if (buildSet) {
			vscodePath = path.join(homeDir, '.vscode');
			if (process.platform === 'darwin') { // for local debug
				positronPath = path.join(homeDir, 'Library/Application\ Support/Positron');
			} else { // linux, test not planned for Windows yet
				positronPath = path.join(homeDir, '.config/Positron');
			}
			console.log(`Release, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
		} else {
			vscodePath = path.join(homeDir, '.vscode-oss-dev');
			positronPath = path.join(homeDir, '.positron-dev');
			console.log(`Dev, vscodePath: ${vscodePath}, positronPath: ${positronPath}`);
		}

		execSync(`rm -rf ${vscodePath} ${positronPath}`);

	});

	test('Python - Add a default interpreter (Conda)', async function ({ app, userSettings, runCommand }) {

		await app.workbench.console.waitForInterpretersToFinishLoading();

		// close qa-example-content
		await runCommand('workbench.action.closeFolder');

		await expect(async () => {
			await app.workbench.console.waitForInterpretersToFinishLoading();

			// local debugging sample:
			// await userSettings.set([['python.defaultInterpreterPath', `"${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}"`]], false);

			// hidden interpreter (Conda)
			await userSettings.set([['python.defaultInterpreterPath', '"/home/runner/scratch/python-env/bin/python"']], false);
		}).toPass({ timeout: 45000 });

		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);

		await app.workbench.console.barClearButton.click();

		await app.workbench.console.pasteCodeToConsole('import sys; print(sys.version)');
		await app.workbench.console.sendEnterKey();

		// local debugging sample:
		// await app.workbench.console.waitForConsoleContents('3.13.0', {expectedCount: 1});

		// hidden interpreter (Conda)
		await app.workbench.console.waitForConsoleContents('3.12.9', { expectedCount: 1 });
	});
});
