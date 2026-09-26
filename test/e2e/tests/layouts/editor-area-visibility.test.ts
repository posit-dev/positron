/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Editor Area Visibility', {
	tag: [tags.LAYOUTS]
}, () => {

	test('Editor area stays visible when its last editor moves to a new window', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/9463' },
		],
	}, async function ({ app, openDataFile }) {
		const { layouts, editorActionBar } = app.workbench;

		await openDataFile('data-files/small_file.csv');
		await editorActionBar.verifyOpenInNewWindow(app.web, 'Data: small_file.csv');

		// The main window keeps its editor area, so the editor can be moved back into it
		await layouts.expectEditorAreaToBeVisible(true);
	});
});
