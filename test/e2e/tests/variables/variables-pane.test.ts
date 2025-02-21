/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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

	test('Python - Verify Variables pane basic function', async function ({ app, logger, python }) {
		const executeCode = async (code: string) => {
			await app.workbench.console.executeCode('Python', code);
		};

		await executeCode('x=1');
		await executeCode('y=10');
		await executeCode('z=100');
		await executeCode('_=1000');

		logger.log('Entered lines in console defining variables');
		await app.workbench.console.logConsoleContents();
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.workbench.variables.getFlatVariables();

		expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'int' });
		expect(variablesMap.get('y')).toStrictEqual({ value: '10', type: 'int' });
		expect(variablesMap.get('z')).toStrictEqual({ value: '100', type: 'int' });
		expect(variablesMap.get('_')).toStrictEqual({ value: '1000', type: 'int' });

	});

	test.skip('Python - Verify only 1 entry per environment', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5887' }],
	}, async function ({ app, logger, python }) {
		await app.workbench.console.barClearButton.click();
		await app.workbench.console.barRestartButton.click();
		await app.workbench.console.waitForReady('>>>');
		await app.workbench.console.waitForConsoleContents('restarted');
		const groupList = app.workbench.variables.getVariablesGroupList();
		expect((await groupList).length).toBe(1);
	});

	test('R - Verify Variables pane basic function', async function ({ app, logger, r }) {
		const executeCode = async (code: string) => {
			await app.workbench.console.executeCode('R', code);
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


	test.skip('R - Verify only 1 entry per environment', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5887' }],
	}, async function ({ app, logger, r }) {
		await app.workbench.console.barClearButton.click();
		await app.workbench.console.barRestartButton.click();
		await app.workbench.console.waitForReady('>');
		await app.workbench.console.waitForConsoleContents('restarted');
		const groupList = app.workbench.variables.getVariablesGroupList();
		expect((await groupList).length).toBe(1);
	});
});
