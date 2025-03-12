/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Default Interpreters', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {

	let orginalSettings: string;

	test.beforeAll(async function ({ app }) {
		orginalSettings = await app.workbench.settings.backupWorkspaceSettings();

		await app.workbench.settings.removeWorkspaceSettings(['interpreters.startupBehavior']);

		const homeDir = process.env.HOME || '';
		const buildSet = !!process.env.BUILD;

		let vscodePath: string;
		let positronPath: string;
		if (buildSet) {
			vscodePath = path.join(homeDir, '.vscode');
			if (process.platform === 'darwin') {
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

	test.afterAll(async function ({ app }) {
		await app.workbench.settings.restoreWorkspaceSettings(orginalSettings);
	});

	test('Python - Add a default interpreter', async function ({ app, userSettings }) {

		//await userSettings.set([['python.defaultInterpreterPath', '"/home/runner/scratch/python-env/bin/python"']], true);

		const homeDir = process.env.HOME || '';
		await userSettings.set([['python.defaultInterpreterPath', `"${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}"`]], true);

		await app.code.wait(60000);


	});
});
