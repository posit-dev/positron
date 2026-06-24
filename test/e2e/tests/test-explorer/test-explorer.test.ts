/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { copyFixtureFolder } from '../../infra/test-runner';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Test Explorer', { tag: [tags.TEST_EXPLORER, tags.R_PKG_DEVELOPMENT, tags.ARK, tags.WEB, tags.WIN] }, () => {
	// A toy R package fixture, incubated inside positron-r (beside the vscodereporter
	// resources) to avoid cross-repo coordination with qa-example-content while the
	// test explorer e2e stabilizes.
	const FIXTURE_NAME = 'r.pkg.test.explorer.fixture';

	test.beforeAll(async function ({ app }) {
		const source = path.join(process.cwd(), 'extensions/positron-r/resources/testing', FIXTURE_NAME);
		const destination = path.join(path.dirname(app.workspacePathOrFolder), FIXTURE_NAME);
		copyFixtureFolder(source, destination);
	});

	test.beforeEach(async function ({ app, openFolder }) {
		const { testExplorer, sessions } = app.workbench;
		await openFolder(FIXTURE_NAME);
		await testExplorer.openTestExplorer();
		// Tests share one app instance; reset to a known state.
		await testExplorer.collapseAllTests();
		await testExplorer.clearAllTestResults();
		await sessions.start('r');
	});

	test('Basic R Test Explorer Functionality', async function ({ app }) {
		const { testExplorer } = app.workbench;

		await testExplorer.expectTestItems(['test-test-that.R', 'test-describe-it.R']);
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

	// https://github.com/posit-dev/positron/issues/10133
	test('Test with multi-line description can be run by itself', async function ({ app }) {
		const { testExplorer } = app.workbench;
		const MULTI_LINE_LABEL = 'test_that with a multi-line description passes';

		await testExplorer.expectTestItems(['test-multi-line-desc.R']);
		await testExplorer.expandAllTests();

		await testExplorer.runTest(MULTI_LINE_LABEL);
		await testExplorer.expectTestStatus(MULTI_LINE_LABEL, 'Passed', 60000);
	});
});
