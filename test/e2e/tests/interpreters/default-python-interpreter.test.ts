/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';
import { deletePositronHistoryFiles, getPrimaryInterpretersText } from './helpers/default-interpreters.js';

test.use({
	suiteId: __filename
});

// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
test.describe.fixme('Default Interpreters - Python', {
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

	test('Python - Add a default interpreter (Conda)', async function ({ app, runCommand }) {

		await app.workbench.console.waitForInterpretersToFinishLoading();

		await runCommand('workbench.action.reloadWindow');

		const interpretersText = await getPrimaryInterpretersText(app);

		// local debugging:
		// expect(interpretersText.some(text => text.includes("3.13.0"))).toBe(true);

		// hidden CI interpreter:
		expect(interpretersText.some(text => text.includes("3.12.9"))).toBe(true);
	});
});
