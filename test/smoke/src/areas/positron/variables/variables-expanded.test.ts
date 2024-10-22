/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';

describe('Variables - Expanded View #pr', () => {
	setupAndStartApp();

	beforeEach(async function () {
		const app = this.app as Application;
		await PositronPythonFixtures.SetupFixtures(app);
		await app.workbench.positronConsole.executeCode('Python', script, '>>>');
		await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

	});

	it('should display children and value', async function () {
		const app = this.app as Application;
		const variables = app.workbench.positronVariables;
		await variables.expandVariable('df');
		await variables.verifyVariableChildrenValues('foo', expectedChildrenData['foo']);
		await variables.verifyVariableChildrenValues('bar', expectedChildrenData['bar']);
		await variables.verifyVariableChildrenValues('ham', expectedChildrenData['ham']);
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
        "a": [None, 2, 3],
        "b": [0.5, None, 2.5],
        "c": [True, None, False],
    }
)
`;

const expectedChildrenData = {
	"foo": [
		{ key: '0', value: '1' },
		{ key: '1', value: '2' },
		{ key: '2', value: '3' }
	],
	"bar": [
		{ key: '0', value: '6.0' },
		{ key: '1', value: '7.0' },
		{ key: '2', value: '8.0' }
	],
	"ham": [
		{ key: '0', value: 'datetime.date(2020, 1, 2)' },
		{ key: '1', value: 'datetime.date(2021, 3, 4)' },
		{ key: '2', value: 'datetime.date(2022, 5, 6)' }
	]
};
