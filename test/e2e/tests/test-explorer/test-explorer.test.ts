/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Test Explorer', { tag: [tags.TEST_EXPLORER, tags.WEB] }, () => {
	test.beforeAll(async function ({ app, settings, hotKeys }) {
		try {
			// don't use native file picker
			await settings.set({
				'files.simpleDialog.enable': true
			}, { reload: true });
		} catch (e) {
			await app.code.driver.takeScreenshot('testExplorerSetup');
			throw e;
		}
	});

	test('R - Verify Basic Test Explorer Functionality', {
		tag: [tags.ARK]
	}, async function ({ app, openFolder }) {

		// Open R package embedded in qa-example-content
		await openFolder(path.join('qa-example-content/workspaces/r_testing'));

		await app.workbench.sessions.expectAllSessionsToBeReady();

		await app.workbench.sessions.start('r');

		await expect(async () => {
			await app.workbench.testExplorer.openTestExplorer();
			await app.workbench.sessions.expectAllSessionsToBeReady();
			await app.workbench.testExplorer.verifyTestFilesExist(['test-mathstuff.R']);
		}).toPass({ timeout: 60000 });

		await app.workbench.testExplorer.runAllTests();

		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

		await expect(async () => {
			const testResults = await app.workbench.testExplorer.getTestResults();

			expect(testResults[0].caseText).toBe('nothing really');
			expect(testResults[0].status).toBe('fail');

			expect(testResults[1].caseText).toBe('subtraction works');
			expect(testResults[1].status).toBe('pass');

			expect(testResults[2].caseText).toBe('subtraction `still` "works"');
			expect(testResults[2].status).toBe('pass');

			expect(testResults[3].caseText).toBe('x is \'a\'');
			expect(testResults[3].status).toBe('pass');

			expect(testResults[4].caseText).toBe('x is \'a\' AND y is \'b\'');
			expect(testResults[4].status).toBe('pass');

			expect(testResults[5].caseText).toBe('whatever');
			expect(testResults[5].status).toBe('pass');

			expect(testResults[6].caseText).toBe('can \'add\' two numbers');
			expect(testResults[6].status).toBe('pass');

			expect(testResults[7].caseText).toBe('can multiply two numbers');
			expect(testResults[7].status).toBe('pass');

			expect(testResults[8].caseText).toBe('can be multiplied by a scalar');
			expect(testResults[8].status).toBe('pass');

			expect(testResults[9].caseText).toBe('is true');
			expect(testResults[9].status).toBe('pass');

			expect(testResults[10].caseText).toBe('can add two numbers');
			expect(testResults[10].status).toBe('pass');

			expect(testResults[11].caseText).toBe('can multiply two numbers');
			expect(testResults[11].status).toBe('pass');

			expect(testResults[12].caseText).toBe('a second it()');
			expect(testResults[12].status).toBe('pass');
		}).toPass({ timeout: 50000 });
	});
});
