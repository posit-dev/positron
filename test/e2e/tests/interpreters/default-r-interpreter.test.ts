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
test.describe.fixme('Default Interpreters - R', {
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ userSettings }) {

		// local debugging sample:
		// await userSettings.set([['positron.r.interpreters.default', '"/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R"']], false);

		// hidden CI interpreter:
		await userSettings.set([['positron.r.interpreters.default', '"/home/runner/scratch/R-4.4.1/bin/R"']], false);

		await deletePositronHistoryFiles();

	});

	test('R - Add a default interpreter', async function ({ app, runCommand }) {

		await app.workbench.console.waitForInterpretersToFinishLoading();

		await runCommand('workbench.action.reloadWindow');

		const interpretersText = await getPrimaryInterpretersText(app);

		// local debugging:
		// expect(interpretersText.some(text => text.includes("4.3.3"))).toBe(true);

		// hidden CI interpreter:
		expect(interpretersText.some(text => text.includes("4.4.1"))).toBe(true);

	});
});
