/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup.js';


test.use({
	suiteId: __filename
});

test.describe('Outline', { tag: [tags.WEB, tags.WIN, tags.OUTLINE] }, () => {

	test.afterAll(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.describe('Outline: Basic', () => {

		test('R - Verify Outline Contents', {
			tag: [tags.ARK]
		}, async function ({ app, r, openFile }) {
			await openFile(join('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
			await app.workbench.outline.expectOutlineToContain([
				'con',
				'albums',
				'df',
			]);
		});
	});

});

