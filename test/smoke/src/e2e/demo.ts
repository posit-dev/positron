/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { test as base } from '@playwright/test';

const test = base.extend<{
	testFixture: string;
	autoTestFixture: string;
	unusedFixture: string;
}, {
	workerFixture: string;
	autoWorkerFixture: string;
}>({
	workerFixture: [async ({ browser }) => {
		// workerFixture setup...
		await use('workerFixture');
		// workerFixture teardown...
	}, { scope: 'worker' }],

	autoWorkerFixture: [async ({ browser }) => {
		// autoWorkerFixture setup...
		await use('autoWorkerFixture');
		// autoWorkerFixture teardown...
	}, { scope: 'worker', auto: true }],

	testFixture: [async ({ page, workerFixture }) => {
		// testFixture setup...
		await use('testFixture');
		// testFixture teardown...
	}, { scope: 'test' }],

	autoTestFixture: [async () => {
		// autoTestFixture setup...
		await use('autoTestFixture');
		// autoTestFixture teardown...
	}, { scope: 'test', auto: true }],

	unusedFixture: [async ({ page }) => {
		// unusedFixture setup...
		await use('unusedFixture');
		// unusedFixture teardown...
	}, { scope: 'test' }],
});

test.beforeAll(async () => { /* ... */ });
test.beforeEach(async ({ page }) => { /* ... */ });
test('first test', async ({ page }) => { /* ... */ });
test('second test', async ({ testFixture }) => { /* ... */ });
test.afterEach(async () => { /* ... */ });
test.afterAll(async () => { /* ... */ });
