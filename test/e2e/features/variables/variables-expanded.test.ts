/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables - Expanded View', { tag: ['@web', '@variables'] }, () => {
	test.beforeEach(async function ({ app, python }) {
		await app.workbench.positronConsole.executeCode('Python', script, '>>>');
		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');
	});

	test('Python - should display children values and types when variable is expanded', async function ({ app }) {
		const variables = app.workbench.positronVariables;

		await variables.expandVariable('df');
		for (const variable of Object.keys(expectedData)) {
			const actualData = await variables.getVariableChildren(variable);
			expect(actualData).toEqual(expectedData[variable]);
		}
	});
});

const script = `
import polars as pl

from datetime import date
df = pl.DataFrame(
	{
		"foo": [1, 2, 3],
		"bar": [6.0, 7.0, 8.0],
		"ham": [date(2020, 1, 2), date(2021, 3, 4), date(2022, 5, 6)],
		"green": [None, 2, 3],
		"eggs": [0.5, None, 2.5],
		"cheese": [True, None, False],
	}
)
`;

const expectedData = {
	foo: { 0: { type: "int", value: "1" }, 1: { type: "int", value: "2" }, 2: { type: "int", value: "3" } },
	bar: { 0: { type: "float", value: "6.0" }, 1: { type: "float", value: "7.0" }, 2: { type: "float", value: "8.0" } },
	ham: { 0: { type: "date", value: "datetime.date(2020, 1, 2)" }, 1: { type: "date", value: "datetime.date(2021, 3, 4)" }, 2: { type: "date", value: "datetime.date(2022, 5, 6)" } },
	green: { 0: { type: "NoneType", value: "None" }, 1: { type: "int", value: "2" }, 2: { type: "int", value: "3" } },
	eggs: { 0: { type: "float", value: "0.5" }, 1: { type: "NoneType", value: "None" }, 2: { type: "float", value: "2.5" } },
	cheese: { 0: { type: "bool", value: "True" }, 1: { type: "NoneType", value: "None" }, 2: { type: "bool", value: "False" } },
};
