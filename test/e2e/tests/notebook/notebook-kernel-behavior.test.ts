/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Kernel Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Validate notebook session states during start, restart, and shutdown', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// create new notebook
		await notebooksPositron.newNotebook();

		// ensure when no kernel is selected, restart/shutdown are disabled
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Change Kernel', enabled: true },
			{ label: 'Open Notebook Console', enabled: true },
			{ label: 'Restart Kernel', enabled: false },
			{ label: 'Shutdown Kernel', enabled: false },
		]);

		// select kernel and ensure while starting, restart/shutdown are disabled
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', enabled: false },
			{ label: 'Shutdown Kernel', enabled: false },
		]);

		// ensure once started and ready, restart/shutdown are enabled
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'Idle'
		});
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', enabled: true },
			{ label: 'Shutdown Kernel', enabled: true },
		]);

		// restart kernel and ensure state changes
		await notebooksPositron.kernel.restart({ waitForRestart: false });
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'Active'
		});
		// ISSUE - https://github.com/posit-dev/positron/issues/10145
		// await notebooksPositron.kernel.expectKernelToBe({
		// 	kernelGroup: 'Python',
		// 	status: 'Idle'
		// })
		await notebooksPositron.kernel.expectStatusToBe('Idle', 15000); // remove once above issue is resolved

		// shut down kernel and ensure menu options
		await notebooksPositron.kernel.shutdown();
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', enabled: false },
			{ label: 'Shutdown Kernel', enabled: false },
			{ label: 'Change Kernel', enabled: true },
			{ label: 'Open Notebook Console', enabled: true },
		]);
	});

	test('Notebook Variable Behavior with Restart', async function ({ app }) {
		const { notebooksPositron, variables } = app.workbench;

		// create new notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');

		// cell 0: create variable x and ensure it exists
		await notebooksPositron.addCodeToCell(0, 'x = 10', { run: true });
		await variables.expectVariableToBe('x', '10');

		// cell 1: create variable y and ensure it exists
		await notebooksPositron.addCodeToCell(1, 'y = 3', { run: true });
		await variables.expectVariableToBe('y', '3');

		// verify execution orders
		await notebooksPositron.expectExecutionOrderAtIndexToBe(0, 1);
		await notebooksPositron.expectExecutionOrderAtIndexToBe(1, 2);

		// restart kernel and ensure variables are cleared
		await notebooksPositron.kernel.restart({ waitForRestart: true });
		await variables.expectVariableToNotExist('x');
		await variables.expectVariableToNotExist('y');

		// verify execution orders persist
		await notebooksPositron.expectExecutionOrderAtIndexToBe(0, 1);
		await notebooksPositron.expectExecutionOrderAtIndexToBe(1, 2);

		// verify cell outputs persist
		// to do

		// run cell 0 again and ensure execution order restarts at 1
		await notebooksPositron.runCodeAtIndex(0);
		await notebooksPositron.expectExecutionOrderAtIndexToBe(0, 1);
	});
});
