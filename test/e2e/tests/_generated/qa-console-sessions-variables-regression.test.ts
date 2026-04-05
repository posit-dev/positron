/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA: Console sessions and variables regression', async function ({ app }) {
	const { sessions, console, variables, dataExplorer } = app.workbench;

	// Start Python and create multiple variable types
	await sessions.start('python');
	await console.executeCode('Python', [
		'x = 42',
		'name = "hello"',
		'my_list = [1, 2, 3]',
	].join('\n'));
	await variables.expectVariableToBe('x', '42');
	await variables.expectVariableToBe('name', '\'hello\'');
	await variables.expectVariableToBe('my_list', '[1, 2, 3]');

	// Expand and collapse a list variable
	await variables.expandVariable('my_list');
	await variables.collapseVariable('my_list');

	// Start R and verify its variables
	await sessions.start('r');
	await console.executeCode('R', [
		'r_val <- 3.14',
		'r_name <- "world"',
	].join('\n'));
	await variables.expectVariableToBe('r_val', '3.14');
	await variables.expectVariableToBe('r_name', '\'world\'');

	// Switch to Python and verify session isolation
	await sessions.select('Python');
	await variables.expectVariableToBe('x', '42');
	await variables.expectVariableToNotExist('r_val');

	// Filter variables and verify
	await variables.setFilterText('my_');
	await variables.expectVariableToBe('my_list', '[1, 2, 3]');
	await variables.setFilterText('');

	// Delete all variables (clicks button and confirms dialog)
	await variables.deleteAllVariables();
	await variables.expectVariableToNotExist('x');

	// Create a DataFrame and open in Data Explorer
	await console.executeCode('Python', [
		'import pandas as pd',
		'df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})',
	].join('\n'));
	await variables.expectVariableToBe('df', '[2 rows x 2 columns] pandas.DataFrame');
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.waitForIdle();
	await dataExplorer.grid.expectColumnHeadersToBe(['a', 'b']);
});
