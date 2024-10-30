/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';

// Tags:
//  - Run all tests WITH the @pr tag - `npx playwright test --grep @pr`
// 	- Run all tests WITHOUT the @slow tag - `npx playwright test --grep-invert @slow`
//  - Run all tests with the @web OR @pr tag - npx playwright test --grep "@web|@pr"
//  - Run all tests with the @web AND @pr tag - npx playwright test --grep "(?=.*@web)(?=.*@pr)"

// Annotations:
// To annotate your tests with more than a tag, you can add a type and description when declaring the test.
// These annotations are available in the reporter API, and Playwright’s HTML reporter shows all annotations,
// except those starting with an underscore.


test.describe('annotations and tags', () => {
	test('should have tags', {
		tag: ['@slow', '@fast'],
	}, async () => {
		// This test is tagged with multiple tags.
	});

	test('should have annotations', {
		annotation: [
			{ type: 'category', description: 'report' },
			{ type: 'issue', description: 'https://github.com/microsoft/playwright/issues/23180' },
			{ type: 'performance', description: 'very slow test!' },
			{ type: 'test case', description: 'https://posit.testrail.io/index.php?/cases/view/534454' }
		],
	}, async () => {
		// This test is annotated with multiple annotations.
	});
});

// Conditional skip a test based on the browser name
test.describe('chromium only', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only!');

	test.beforeAll(async () => {
		// This hook is only run in Chromium.
	});

	test('test 1', async () => {
		// This test is only run in Chromium.
	});

	test('test 2', async () => {
		// This test is only run in Chromium.
	});
});
