/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

const SETUP_CODE = `
import pandas as pd
import numpy as np

df = pd.DataFrame({
	'name': ['Ada', 'Linus', 'Grace'],
	'birth_year': [1815, 1969, 1906],
	'field': ['math', 'systems', 'compilers'],
})
arr = np.array([1.0, 2.5, 3.14])
greeting = "hello, positron"
counter = 42
`.trim();

test.describe('Release screenshots - Variables pane', () => {
	test('populated', async ({ app, page, executeCode, python }) => {
		await executeCode('Python', SETUP_CODE);
		await app.workbench.variables.waitForVariableRow('df');
		await app.workbench.variables.waitForVariableRow('greeting');

		await prepareForScreenshot(app, page);
		await capturePanel(app.workbench.variables.variablesPane, 'variables-pane.png');
	});
});
