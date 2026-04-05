/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('Deep regression: console sessions and variables together', async function ({ app, python }) {
	const { console: consoleView, variables, sessions, dataExplorer } = app.workbench;

	// Create multiple variable types in Python
	await consoleView.executeCode('Python', [
		'import pandas as pd',
		'x = 42',
		"name = 'hello'",
		'my_list = [1, 2, 3]',
		'df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})',
	].join('\n'));

	await variables.expectVariableToBe('x', '42');
	await variables.expectVariableToBe('name', "'hello'");
	await variables.expectVariableToBe('my_list', '[1, 2, 3]');
	await variables.expectVariableToBe('df', '[2 rows x 2 columns] pandas.DataFrame');

	// Expand and collapse a nested variable
	await variables.expandVariable('my_list');
	await variables.collapseVariable('my_list');

	// Filter variables
	await variables.setFilterText('df');
	await variables.expectVariableToBe('df', '[2 rows x 2 columns] pandas.DataFrame');
	await variables.expectVariableToNotExist('x');
	await variables.setFilterText('');

	// Open DataFrame in Data Explorer
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.grid.expectColumnHeadersToBe(['a', 'b']);

	// Start R session and verify variable isolation
	await sessions.start('r');
	await consoleView.executeCode('R', [
		'y <- 100',
		'greeting <- "world"',
		'r_vec <- c(10, 20, 30)',
	].join('\n'));

	await variables.expectVariableToBe('y', '100');
	await variables.expectVariableToBe('greeting', '"world"');
	await variables.expectVariableToBe('r_vec', '10 20 30');
	await variables.expectVariableToNotExist('x');

	// Switch back to Python and verify variables persist
	const pythonSessionId = (await sessions.getAllSessionIdsAndNames())
		.find(s => s.name.includes('Python'))!.id;
	await sessions.select(pythonSessionId);
	await variables.expectVariableToBe('x', '42');
	await variables.expectVariableToBe('df', '[2 rows x 2 columns] pandas.DataFrame');
	await variables.expectVariableToNotExist('y');

	// Delete all Python variables and verify R unaffected
	await variables.deleteAllVariables();
	await variables.expectVariableToNotExist('x');
	await variables.expectVariableToNotExist('df');

	const rSessionId = (await sessions.getAllSessionIdsAndNames())
		.find(s => s.name.includes('R'))!.id;
	await sessions.select(rSessionId);
	await variables.expectVariableToBe('y', '100');
	await variables.expectVariableToBe('greeting', '"world"');

	// Re-create Python variable and restart session to verify clearing
	await sessions.select(pythonSessionId);
	await consoleView.executeCode('Python', 'z = 99');
	await variables.expectVariableToBe('z', '99');

	await sessions.restart(pythonSessionId);
	await consoleView.waitForReadyAndRestarted('>>>');
	await variables.expectVariableToNotExist('z');

	// R data.frame in Data Explorer
	await sessions.select(rSessionId);
	await consoleView.executeCode('R', 'r_df <- data.frame(x = 1:3, y = c("a", "b", "c"))');
	await variables.expandVariable('r_df');
	await variables.collapseVariable('r_df');
	await variables.openVariableInDataExplorer('r_df');
	await dataExplorer.grid.expectColumnHeadersToBe(['x', 'y']);

	// Delete R session, verify Python session still intact
	await sessions.delete(rSessionId);
	await sessions.expectSessionCountToBe(1);
	await variables.expectVariableToNotExist('y');
});
