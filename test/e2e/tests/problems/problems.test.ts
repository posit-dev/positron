/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Problems', {
	tag: [tags.PROBLEMS, tags.WEB, tags.WIN]
}, () => {

	test('Python - Verify problems are highlighted in editor and count is accurate in Problems pane', async function ({ app, python, openFile, keyboard }) {
		const { problems, editor } = app.workbench;

		// Open a Python file and introduce an error
		await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await editor.replaceTerm('chinook-sqlite.py', 'rows', 9, '!');

		// Verify the error is present in Editor and Problems pane
		await problems.expectSquigglyCountToBe('error', 1);
		await problems.expectDiagnosticsToBe({ errorCount: 4 });

		// Undo the changes
		await keyboard.hotKeys.undo();

		// Verify the error is no longer present in Editor and Problems view
		await problems.expectSquigglyCountToBe('error', 1);
		await problems.expectDiagnosticsToBe({ errorCount: 0 });
	});

	test('R - Verify problems are highlighted in editor and count is accurate in Problems pane', async function ({ app, r, openFile, keyboard }) {
		const { problems, editor } = app.workbench;

		// Open an R file and introduce an error
		await openFile(join('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
		await editor.replaceTerm('chinook-sqlite.r', 'albums', 5, '!');

		// Verify the error is present in Editor and Problems pane
		await problems.expectSquigglyCountToBe('error', 1);
		await problems.showProblemsView();
		await problems.expectDiagnosticsToBe({ errorCount: 1 });

		// Undo the changes
		await keyboard.hotKeys.undo();

		// Verify the error is no longer present in Editor and Problems view
		await problems.expectSquigglyCountToBe('error', 1);
		await problems.expectDiagnosticsToBe({ errorCount: 0 });
	});
});

