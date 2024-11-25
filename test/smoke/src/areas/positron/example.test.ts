/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// we must import test from _test.setup to ensure we have the correct test
// context with our custom fixtures
import { test, expect } from './_test.setup';

// we need this to ensure each spec gets a fresh app instance read more here:
// https://positpbc.atlassian.net/wiki/spaces/POSITRON/pages/1224999131/Proof+of+Concept+Playwright#SuiteId
test.use({
	suiteId: __filename
});

test.describe('Examples of Concepts', () => {
	test.beforeAll('How to set User Settings', async function ({ userSettings }) {
		// we set the user settings before all tests in a spec begin
		// the fixture cleans up and unsets after all tests have finished
		await userSettings.set([['files.autoSave', 'false']]);
	});

	test('How to use app instance', async function ({ app }) {
		// the "app" fixture is automatically created and available for use in all tests
		// we just need to reference it in the test function signature to use it
		// note: the app instance is re-created for EACH SPEC FILE
		await expect(app.code.driver.page.getByLabel('Start Interpreter')).toBeVisible();
	});

	test('How to use page instance', async function ({ app, page }) {
		// the first step in this test accesses the page instance directly via the app
		// object (app.code.driver.page), while the second step in this test uses the "page" fixture
		// which is just passing the same app object directly, therefore simplifying the code
		await expect(app.code.driver.page.getByLabel('Start Interpreter')).toBeVisible();
		await expect(page.getByLabel('Start Interpreter')).toBeVisible();
	});

	test('How to use logger', async function ({ logger }) {
		// the "logger" fixture is automatically created and available for use in all tests
		// we just need to reference it in the test function signature to use it
		// log files can be found at: /test-logs and are also attached to the HTML report
		logger.log("This will show up in the log files");
	});

	test('How to set Python/R interpreter at beginning of test', async function ({ page, r }) {
		// we can invoke the "r" interpreter fixture, which will set the interpreter to R
		// before any of the test steps execute
		await expect(page.getByText(/R.*started/)).toBeVisible();
	});

	test('How to set Python/R interpreter anywhere in test', async function ({ page, interpreter }) {
		// we can invoke the "interpreter" fixture, and then set the interpreter to Python or R
		// from anywhere within our test
		await expect(page.getByText(/R.*started|Start Interpreter/)).toBeVisible();
		await interpreter.set('Python');
		await expect(page.getByText(/Python.*started/)).toBeVisible();
	});

	test('How to restart app instance - Option 1', async function ({ restartApp: app }) {
		// in some cases you may want to restart the app instance within a spec file
		// option 1: use the "restartApp" fixture which restarts the app instance at beginning of test
		// before any test steps execute
		await expect(app.code.driver.page.getByLabel('Start Interpreter')).toBeVisible();
	});

	test('How to restart app instance - Option 2', async function ({ app }) {
		// option 2: call the restart method on the app instance from anywhere within the test
		await app.restart();
		await expect(app.code.driver.page.getByLabel('Start Interpreter')).toBeVisible();
	});

});
