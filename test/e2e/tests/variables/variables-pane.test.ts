/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables Pane', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.VARIABLES]
}, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test('Python - Verifies Variables pane basic function [C628634]', async function ({ app, logger, python }) {
		const executeCode = async (code: string) => {
			await app.workbench.console.executeCode('Python', code, '>>>');
		};

		await executeCode('x=1');
		await executeCode('y=10');
		await executeCode('z=100');

		logger.log('Entered lines in console defining variables');
		await app.workbench.console.logConsoleContents();
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.workbench.variables.getFlatVariables();

		expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
		expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
		expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });

	});

	test('R - Verifies Variables pane basic function [C628635]', async function ({ app, logger, r }) {
		const executeCode = async (code: string) => {
			await app.workbench.console.executeCode('R', code, '>');
		};

		await executeCode('x=1');
		await executeCode('y=10');
		await executeCode('z=100');

		logger.log('Entered lines in console defining variables');
		await app.workbench.console.logConsoleContents();
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.workbench.variables.getFlatVariables();

		expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'dbl' });
		expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'dbl' });
	});

	test('Python - Verifies only 1 entery per environment', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5887' }],
	}, async function ({ app, logger, python }) {
		const executeCode = async (code: string) => {
			await app.workbench.console.executeCode('Python', code, '>>>');
		};

		await executeCode('x=1');
		await executeCode('y=10');
		await executeCode('z=100');
		const groupList = app.workbench.variables.getVariablesGroupList();
		expect(groupList).toHaveLength(1);


	});
});


