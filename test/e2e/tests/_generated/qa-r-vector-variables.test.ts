/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('QA: Start R, create a vector, verify it in Variables', async ({ app }) => {
	const { sessions, console, variables } = app.workbench;

	await sessions.start('r');
	await console.executeCode('R', 'x <- c(1, 2, 3)');
	await variables.expectVariableToBe('x', '1 2 3');
	await variables.expandVariable('x');
	await variables.getVariableChildren('x', false);
});
