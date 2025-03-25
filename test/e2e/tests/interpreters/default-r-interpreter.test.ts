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
test.describe('Default Interpreters - R', {
	tag: [tags.INTERPRETER, tags.NIGHTLY_ONLY]
}, () => {

	test.beforeAll(async function ({ userSettings }) {

		// local debugging sample:
		// await userSettings.set([['positron.r.interpreters.default', '"/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R"']], false);

		// hidden CI interpreter:
		await userSettings.set([['positron.r.interpreters.default', '"/home/runner/scratch/R-4.4.1/bin/R"']], false);

		await deletePositronHistoryFiles();

	});

	test('R - Add a default interpreter', async function ({ app, runCommand, sessions }) {
		await app.workbench.console.waitForInterpretersToFinishLoading();
		await runCommand('workbench.action.reloadWindow');
		await app.workbench.console.waitForReady('>');

		const { name, path } = await sessions.getMetadata();

		// Local debugging sample:
		// expect(name).toContain('R 4.3.3');
		// expect(path).toContain('R.framework/Versions/4.3-arm64/Resources/R');

		// hidden CI interpreter:
		expect(name).toContain(/R 4.4.1/);
		expect(path).toContain('R-4.4.1/bin/R');
	});
});
