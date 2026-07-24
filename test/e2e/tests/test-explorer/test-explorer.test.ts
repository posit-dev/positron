/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import fs = require('fs');
import { copyFixtureFolder } from '../../infra/test-runner';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Test Explorer', { tag: [tags.TEST_EXPLORER, tags.R_PKG_DEVELOPMENT, tags.ARK, tags.WEB, tags.WIN] }, () => {
	// A toy R package fixture, incubated inside positron-r (beside the vscodereporter
	// resources) rather than in the shared e2e test-files, while the test explorer
	// e2e stabilizes.
	const FIXTURE_NAME = 'r.pkg.test.explorer.fixture';
	const FIXTURE_SOURCE = path.join(process.cwd(), 'extensions/positron-r/resources/testing', FIXTURE_NAME);

	const WATCHER_TIMEOUT = 30000;

	// Each test gets its own copy of the fixture.
	// That's why the folder name includes the test title.
	// The goal is to avoid flakiness due to one test failing to create or
	// delete something, thereby causing spurious failure of other tests.
	// The folder name also includes worker index, so it's possible to use
	// `--repeat-each` during development to check for flakiness, without
	// creating file system crosstalk between concurrent runs of a single test.
	function fixtureFolderFor(title: string, workerIndex: number): string {
		const slug = title.replace(/[^a-z0-9]+/gi, '-');
		return `${FIXTURE_NAME}.${slug}.w${workerIndex}`;
	}

	test.beforeEach(async function ({ app, openFolder }, testInfo) {
		const { testExplorer, sessions } = app.workbench;
		const fixtureFolder = fixtureFolderFor(testInfo.title, testInfo.workerIndex);
		copyFixtureFolder(FIXTURE_SOURCE, path.join(path.dirname(app.workspacePathOrFolder), fixtureFolder));

		await openFolder(fixtureFolder);
		await testExplorer.openTestExplorer();
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

	test('Tests with tricky descriptions report the correct status', async function ({ app }) {
		const { testExplorer } = app.workbench;

		await testExplorer.expectTestItems(['test-tricky-desc.R']);
		await testExplorer.runAllTests();
		await testExplorer.expectTestStatus('test-tricky-desc.R', 'Failed', 60000);

		await testExplorer.expandAllTests();
		await testExplorer.expectTestStatus('test_that with a multi-line description passes', 'Passed');
		await testExplorer.expectTestStatus('test_that with \'single quotes\' fails', 'Failed');
		await testExplorer.expectTestStatus('test_that with one \' single quote passes', 'Passed');
		await testExplorer.expectTestStatus('test_that with `backticks` fails', 'Failed');
		await testExplorer.expectTestStatus('test_that with an & ampersand passes', 'Passed');
		await testExplorer.expectTestStatus('test_that with a slash / fails', 'Failed');
	});

	// https://github.com/posit-dev/positron/issues/10133
	test('Tests with tricky descriptions can be run individually', async function ({ app }) {
		const { testExplorer } = app.workbench;

		await testExplorer.expectTestItems(['test-tricky-desc.R']);
		await testExplorer.expandAllTests();

		await testExplorer.runTest('test_that with a multi-line description passes');
		await testExplorer.expectTestStatus('test_that with a multi-line description passes', 'Passed', 60000);

		await testExplorer.runTest('test_that with \'single quotes\' fails');
		await testExplorer.expectTestStatus('test_that with \'single quotes\' fails', 'Failed', 60000);

		await testExplorer.runTest('test_that with `backticks` fails');
		await testExplorer.expectTestStatus('test_that with `backticks` fails', 'Failed', 60000);
	});

	// https://github.com/posit-dev/positron/issues/2929
	test('Deleting or renaming a test file updates the tree', async function ({ app }, testInfo) {
		const { testExplorer } = app.workbench;
		const testthatDir = path.join(path.dirname(app.workspacePathOrFolder), fixtureFolderFor(testInfo.title, testInfo.workerIndex), 'tests', 'testthat');

		await testExplorer.expectTestItems(['test-test-that.R', 'test-describe-it.R']);

		fs.rmSync(path.join(testthatDir, 'test-test-that.R'));
		await testExplorer.expectNoTestItem('test-test-that.R', WATCHER_TIMEOUT);

		fs.renameSync(path.join(testthatDir, 'test-describe-it.R'), path.join(testthatDir, 'test-renamed.R'));
		await testExplorer.expectTestItems(['test-renamed.R'], WATCHER_TIMEOUT);
		await testExplorer.expectNoTestItem('test-describe-it.R', WATCHER_TIMEOUT);
	});

	// Edge case of https://github.com/posit-dev/positron/issues/14499
	test('Out-of-band edits to a test file update the tree', async function ({ app }, testInfo) {
		const { testExplorer } = app.workbench;
		const testthatDir = path.join(path.dirname(app.workspacePathOrFolder), fixtureFolderFor(testInfo.title, testInfo.workerIndex), 'tests', 'testthat');

		// Make sure test-test-that.R has been materialized in the explorer.
		await testExplorer.expandAllTests();
		// These are the children nodes (the tests) in test-test-that.R.
		await testExplorer.expectTestItems(['test_that number 1 passes', 'test_that number 2 fails']);

		// Rewrite the file out-of-band via write-temp-then-rename, to imitate
		// a coding agent.
		const rewritten = [
			'test_that("test_that number 1 passes", {',
			'  expect_equal(2 * 2, 4)',
			'})',
			'',
			'test_that("added out of band", {',
			'  expect_true(TRUE)',
			'})',
			''
		].join('\n');
		const scratch = path.join(testthatDir, 'scratch-rewrite.R');
		fs.writeFileSync(scratch, rewritten);
		fs.renameSync(scratch, path.join(testthatDir, 'test-test-that.R'));

		await testExplorer.expectTestItems(['added out of band'], WATCHER_TIMEOUT);
		await testExplorer.expectNoTestItem('test_that number 2 fails', WATCHER_TIMEOUT);
	});

	// Clear-on-run: a run that stops partway must clear stale results, not leave them behind.
	test('A run that stops partway clears stale results', async function ({ app }, testInfo) {
		const { testExplorer } = app.workbench;
		const testthatDir = path.join(path.dirname(app.workspacePathOrFolder), fixtureFolderFor(testInfo.title, testInfo.workerIndex), 'tests', 'testthat');
		const BEFORE = 'runs before the stop';
		const AFTER = 'runs after the stop';

		// First run: no STOP sentinel, so the whole file runs and both tests pass.
		await testExplorer.runAllTests();
		await testExplorer.expectTestStatus('test-early-stop.R', 'Passed', 60000);
		await testExplorer.expandAllTests();
		await testExplorer.expectTestStatus(BEFORE, 'Passed');
		await testExplorer.expectTestStatus(AFTER, 'Passed');

		// Drop the sentinel so a top-level stop() ends the file after the first test.
		fs.writeFileSync(path.join(testthatDir, 'STOP'), '');

		// Second run: the file stops after BEFORE, so AFTER never runs. Its prior
		// 'Passed' must be cleared to 'Skipped', not left stale.
		await testExplorer.runAllTests();
		await testExplorer.expectTestStatus(AFTER, 'Skipped', 60000);
	});

	test('A running test can be cancelled', async function ({ app }, testInfo) {
		const { testExplorer } = app.workbench;
		const testthatDir = path.join(path.dirname(app.workspacePathOrFolder), fixtureFolderFor(testInfo.title, testInfo.workerIndex), 'tests', 'testthat');
		const LABEL = 'a test that can be cancelled';

		// This sentinel file triggers a long sleep in the test, which opens a
		// nice window for us to cancel it here.
		fs.writeFileSync(path.join(testthatDir, 'CANCEL'), '');

		await testExplorer.expectTestItems(['test-cancel.R']);
		await testExplorer.expandAllTests();
		await testExplorer.runTest(LABEL);

		// Make sure the test is actually running (not just queued), so we
		// exercise the interrupt, rather than a no-op cancel of a queued run.
		await testExplorer.expectTestIcon(LABEL, 'Running', 60000);
		await testExplorer.cancelTestRun();

		// Core marks any cancelled run Skipped, so also verify R was explicitly
		// interrupted.
		await expect.poll(() => fs.existsSync(path.join(testthatDir, 'ON.EXIT')), { timeout: 45000 }).toBe(true);
		expect(fs.existsSync(path.join(testthatDir, 'SLEEP COMPLETED'))).toBe(false);
		await testExplorer.expectTestStatus(LABEL, 'Skipped', 60000);
	});
});
