/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { copyFixtureFolder } from '../../infra/test-runner';
import { test as base, expect, tags } from '../_test.setup';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ useLegacyNotebookEditor, enableDataConnections, settingsFile }, use) => {
			if (useLegacyNotebookEditor) {
				await settingsFile.append({ 'positron.notebook.enabled': false });
			}
			if (enableDataConnections) {
				await settingsFile.append({ 'dataConnections.enabled': true });
			}
			await settingsFile.append({ 'files.simpleDialog.enable': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('R Test Explorer', { tag: [tags.TEST_EXPLORER, tags.R_PKG_DEVELOPMENT, tags.ARK, tags.WEB, tags.WIN] }, () => {
	// A toy R package fixture, incubated inside positron-r (beside the vscodereporter
	// resources) to avoid cross-repo coordination with qa-example-content while the
	// test explorer e2e stabilizes.
	const FIXTURE_NAME = 'r.pkg.test.explorer.fixture';

	test.beforeAll(async function ({ app, settings }) {
		const source = path.join(process.cwd(), 'extensions/positron-r/resources/testing', FIXTURE_NAME);
		const destination = path.join(path.dirname(app.workspacePathOrFolder), FIXTURE_NAME);
		copyFixtureFolder(source, destination);

		// don't use native file picker
		await settings.set({
			'files.simpleDialog.enable': true
		}, { reload: true, waitForReady: true });
	});

	test('Basic R Test Explorer Functionality', async function ({ app, openFolder }) {

		await openFolder(FIXTURE_NAME);

		await app.workbench.sessions.expectAllSessionsToBeReady();

		await app.workbench.sessions.start('r');

		const testExplorer = app.workbench.testExplorer;

		await expect(async () => {
			await testExplorer.openTestExplorer();
			await app.workbench.sessions.expectAllSessionsToBeReady();
			// Do the test files appear in the tree?
			await testExplorer.expectTestItems(['test-test-that.R', 'test-describe-it.R']);
		}).toPass({ timeout: 60000 });

		await testExplorer.runAllTests();

		// Both files contain a failure, so each will have 'Failed' status.
		// The run is async, so we wait before the first expectation.
		await testExplorer.expectTestStatus('test-describe-it.R', 'Failed', 60000);
		await testExplorer.expectTestStatus('test-test-that.R', 'Failed');

		// Reveal the test_that() and describe()/it() items inside the files.
		await testExplorer.expandAllTests();

		await testExplorer.expectTestStatus('simple describe() 1 passes', 'Passed');
		await testExplorer.expectTestStatus('it number 1-1', 'Passed');
		await testExplorer.expectTestStatus('it number 1-2', 'Passed');

		await testExplorer.expectTestStatus('simple describe() 2 fails', 'Failed');
		await testExplorer.expectTestStatus('it number 2-1 fails', 'Failed');

		await testExplorer.expectTestStatus('test_that number 1 passes', 'Passed');
		await testExplorer.expectTestStatus('test_that number 2 fails', 'Failed');

	});
});
