/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});

test.describe('Variables Pane - Notebook', {
	tag: [tags.CRITICAL, tags.WEB, tags.VARIABLES, tags.POSITRON_NOTEBOOKS]
}, () => {
	test('R - Verify Variables pane basic function for notebook', {
		tag: [tags.ARK]
	}, async function ({ app, hotKeys, r }) {
		const { notebooksPositron, variables } = app.workbench;

		// Create a variable via a notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'y <- c(2, 3, 4, 5)', { run: true });

		// Verify the var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectVariableToBe('y', '2 3 4 5');
	});

	test('Python - Verify Variables pane basic function for notebook', async function ({ app, python }) {
		const { notebooksPositron, variables, hotKeys } = app.workbench;

		// Create a variable via a notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'y = [2, 3, 4, 5]', { run: true });

		// Verify the var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectVariableToBe('y', '[2, 3, 4, 5]');
	});

	test('Python - Verify Variables available after reload', async function ({ app, hotKeys, python }) {
		const { notebooksPositron, variables } = app.workbench;

		// Create a variable via a notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'dict = [{"a":1,"b":2},{"a":3,"b":4}]', { run: true });

		// Verify the var in the variable pane
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectVariableToBe('dict', `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`);

		// Reload window
		await hotKeys.reloadWindow(true);

		// After reload a console session is foregrounded; click the notebook tab to surface its variables.
		await app.workbench.editors.clickTab('Untitled-1.ipynb');

		// Ensure the variable is still present
		await variables.expectVariableToBe('dict', `[{'a': 1, 'b': 2}, {'a': 3, 'b': 4}]`, 30000);
	});

	test('Python - Verify variables persist across cells', async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();

		// fast: true avoids Monaco auto-closing brackets corrupting this multi-line
		// code (pressSequentially produced SyntaxErrors); check cell 0 before cell 1.
		await notebooksPositron.addCodeToCell(0, variableCode, { run: true, fast: true });
		await notebooksPositron.expectOutputAtIndex(0, ['Hello from first cell']);

		await notebooksPositron.addCodeToCell(1, useVariableCode, { run: true, fast: true });
		await notebooksPositron.expectOutputAtIndex(1, ['Sum of numbers: 15', 'Modified numbers: [1, 2, 3, 4, 5, 6]']);
	});

	test('Python - Verify Variables pane stays on notebook session after opening Data Explorer', {
		tag: [tags.DATA_EXPLORER]
	}, async function ({ app, hotKeys, python }) {
		const { notebooksPositron, variables, editors } = app.workbench;

		// Create a dataframe in a notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'import pandas as pd\ndf = pd.DataFrame({"a": [1, 2, 3]})', { run: true, waitForSpinner: true });

		// Verify we're on the notebook session
		await hotKeys.fullSizeSecondarySidebar();
		await variables.expectVariableToBe('df', /DataFrame/);

		// Open the Data Explorer by double-clicking the variable
		await variables.doubleClickVariableRow('df');
		await editors.verifyTab('Data: df', { isVisible: true });

		// Verify Variables pane stayed on the notebook session (regression test for #7539)
		await variables.expectVariableToBe('df', /DataFrame/);
	});
});

const variableCode = `# Define variables
global_var = "Hello from first cell"
numbers = [1, 2, 3, 4, 5]
data_dict = {'name': 'test', 'value': 42}

print(f"Global variable: {global_var}")
print(f"Numbers list: {numbers}")
print(f"Data dictionary: {data_dict}")`;


const useVariableCode = `# Use variables from previous cell
print(f"Accessing global_var: {global_var}")
print(f"Sum of numbers: {sum(numbers)}")
print(f"Dictionary value: {data_dict['value']}")

# Modify variables
numbers.append(6)
data_dict['new_key'] = 'new_value'

print(f"Modified numbers: {numbers}")
print(f"Modified dictionary: {data_dict}")`;
