/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Test Explorer', { tag: [tags.TEST_EXPLORER] }, () => {
	test.beforeAll(async function ({ app, r, userSettings }) {
		try {
			// don't use native file picker
			await userSettings.set([[
				'files.simpleDialog.enable',
				'true',
			]]);

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.console.barClearButton.click();
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		} catch (e) {
			await app.code.driver.takeScreenshot('testExplorerSetup');
			throw e;
		}
	});

	test('R - Verify Basic Test Explorer Functionality [C749378]', async function ({ app }) {
		await expect(async () => {
			// Navigate to https://github.com/posit-dev/qa-example-content/tree/main/workspaces/r_testing
			// This is an R package embedded in qa-example-content
			await app.workbench.quickaccess.runCommand('workbench.action.files.openFolder', { keepOpen: true });
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.type(path.join(app.workspacePathOrFolder, 'workspaces', 'r_testing'));
			await app.workbench.quickInput.clickOkOnQuickInput();
			await app.workbench.console.waitForReady('>', 10000);
		}).toPass({ timeout: 50000 });

		await app.workbench.testExplorer.clickTestExplorerIcon();
		await app.workbench.testExplorer.verifyTestFilesExist(['test-mathstuff.R']);

		await app.workbench.testExplorer.runAllTests();

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
