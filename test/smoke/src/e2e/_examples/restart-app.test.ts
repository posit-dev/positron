/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('App Instance Test', { tag: [] }, () => {
	test('1st test creates app instance at worker scope', async ({ app }) => {
		await app.code.driver.wait(1000);
		console.log('1st app instance');
	});

	test('2nd test will reuse app instance', async ({ app }) => {
		await app.code.driver.wait(1000);
		console.log('still the 1st app instance');
	});

	test('3rd test will create a new app instance', async ({ restartApp: app }) => {
		await app.code.driver.wait(1000);
		console.log('2nd app instance');
	});


	test.describe('App Instance Test Nested', () => {
		test('4th test will reuse 2nd app instance - nesting does not matter', async ({ app }) => {
			await app.code.driver.wait(1000);
			console.log('still the 2nd app instance');
		});

		test('5th test will create a new app instance', async ({ restartApp: app }) => {
			await app.code.driver.wait(1000);
			console.log('3rd app instance');
		});
	});
});

