/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';

test.describe.configure({ retries: 2 });

test('should fail first, then pass on retry', { tag: ['@pr'] }, async ({ app, interpreter }, testInfo) => {
	if (testInfo.retry) {
		await interpreter.set('Python');
		await app.workbench.positronLayouts.enterLayout('notebook');
		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.addCodeToFirstCell('this test should PASS! :tada:');

		expect(true).toBe(true);
	} else {
		await app.workbench.positronLayouts.enterLayout('notebook');
		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.addCodeToFirstCell('this test should fail!');
		expect(true).toBe(false);
	}
});
