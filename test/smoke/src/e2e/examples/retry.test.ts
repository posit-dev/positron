/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';

test.describe.configure({ retries: 2 });

test('should fail first, then pass on retry', async ({ interpreter }, testInfo) => {
	await interpreter.set('Python');
	if (testInfo.retry) {
		expect(true).toBe(true);
	} else {
		expect(true).toBe(false);
	}
});
