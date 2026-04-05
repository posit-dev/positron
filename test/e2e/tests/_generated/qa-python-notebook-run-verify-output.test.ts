/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('QA: Open Python notebook, add cell, run, verify output', async ({ app }) => {
	const { notebooksPositron } = app.workbench;

	await notebooksPositron.newNotebook({ codeCells: 1, language: 'Python' });
	await notebooksPositron.addCodeToCell(0, 'print("Hello, Positron!")', { run: true });
	await notebooksPositron.expectOutputAtIndex(0, ['Hello, Positron!']);
});
