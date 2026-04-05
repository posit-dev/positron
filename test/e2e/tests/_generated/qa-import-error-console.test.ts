/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('QA: Import error shows ModuleNotFoundError in console', async ({ app }) => {
	const { sessions, console } = app.workbench;

	await sessions.start('python');
	await console.executeCode('Python', 'import nonexistent_module_xyz');
	await console.expectConsoleToContainError('ModuleNotFoundError');
});
