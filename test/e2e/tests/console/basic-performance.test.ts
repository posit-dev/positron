/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Performance', {
	tag: [tags.SESSIONS, tags.CONSOLE, tags.WEB, tags.WIN]
}, () => {

	test('Python Performance - Console loads under 30 seconds', async ({ app, python, sessions }) => {
		const start = Date.now();
		await sessions.expectAllSessionsToBeReady();
		const end = Date.now();
		const loadTime = (end - start) / 1000;
		console.log(`Python Console load time: ${loadTime.toFixed(2)} seconds`);
		expect(loadTime).toBeLessThan(30);
	});

	test('R Performance - Console loads under 30 seconds', { tag: [tags.ARK] }, async ({ app, r, sessions }) => {
		const start = Date.now();
		await sessions.expectAllSessionsToBeReady();
		const end = Date.now();
		const loadTime = (end - start) / 1000;
		console.log(`R Console load time: ${loadTime.toFixed(2)} seconds`);
		expect(loadTime).toBeLessThan(30);
	});
});
