/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { deletePositronHistoryFiles } from './helpers/default-interpreters.js';

test.use({
	suiteId: __filename
});

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe('Default Interpreters - Python', {
	tag: [tags.INTERPRETER, tags.NIGHTLY_ONLY]
}, () => {

	test.beforeAll(async function ({ userSettings }) {

		// local debugging sample:
		// const homeDir = process.env.HOME || '';
		// await userSettings.set([['python.defaultInterpreterPath', `"${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}"`]], false);

		// hidden interpreter (Conda)
		await userSettings.set([['python.defaultInterpreterPath', '"/home/runner/scratch/python-env/bin/python"']], false);

		await deletePositronHistoryFiles();
	});

	test('Python - Add a default interpreter (Conda)', async function ({ app, runCommand, sessions }) {
		await app.workbench.console.waitForInterpretersToFinishLoading();
		await runCommand('workbench.action.reloadWindow');
		await app.workbench.console.waitForInterpretersToFinishLoading();

		const { name, path } = await sessions.getMetadata();

		// Local debugging sample:
		// expect(name).toContain('Python 3.13.0');
		// expect(path).toContain('.pyenv/versions/3.13.0/bin/python');

		// hidden CI interpreter:
		expect(name).toContain(/Python 3.12.9/);
		expect(path).toContain('python-env/bin/python');
	});
});
