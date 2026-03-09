/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables - Filters', { tag: [tags.WEB, tags.VARIABLES] }, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test('Setting filter text is reflected in the variables pane', async function ({ app, sessions }) {
		const { layouts, console, variables } = app.workbench;
		await layouts.enterLayout('fullSizedAuxBar');

		// Start R and set some variables in R and verify they are present
		await sessions.start('r');
		await console.executeCode('R', 'hello <- 1; foo <- 2');
		await variables.expectVariableToBe('hello', '1');
		await variables.expectVariableToBe('foo', '2');

		// Set a filter and verify that only the filtered variable is present
		await variables.setFilterText('hello');
		await variables.expectVariableToBe('hello', '1');
		await variables.expectVariableToNotExist('foo');

		// Start Python and verify that the filter is cleared and all variables are present
		await sessions.start('python');
		await console.executeCode('Python', 'hello = 1; foo = 2');
		await variables.expectVariableToBe('hello', '1');
		await variables.expectVariableToBe('foo', '2');

		// Set a filter and verify that only the filtered variable is present
		await variables.setFilterText('foo');
		await variables.expectVariableToBe('foo', '2');
		await variables.expectVariableToNotExist('hello');
	});
});
