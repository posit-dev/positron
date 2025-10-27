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
		await notebooksPositron.kernel.select('Python', { waitForReady: false });
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

	test('Validate persistence with notebook restart', async function ({ app, page }) {
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

		// cell 3: render data frame with HTML
		await notebooksPositron.addCodeToCell(2, rDataFrame, { run: true });
		await notebooksPositron.expectOutputAtIndex(2, rawOutput);

		// verify execution orders
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
			{ index: 2, order: 3 },
		]);

		// restart kernel and ensure variables are cleared
		await notebooksPositron.kernel.restart({ waitForRestart: true });
		await variables.expectVariableToNotExist('x');
		await variables.expectVariableToNotExist('y');

		// verify execution orders persist
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
		]);

		// verify html cell output persists and remains unchanged
		await notebooksPositron.expectOutputAtIndex(2, rawOutput);

		// run cell 0 again and ensure execution order restarts at 1
		await notebooksPositron.runCodeAtIndex(1);
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 }, // from previous session (pre-reload)
			{ index: 1, order: 1 }, // from current session (post-reload)
			{ index: 2, order: 3 }, // from previous session (pre-reload)

		]);
	});
});

const rDataFrame = `data.frame(
name = c("Alice", "Bob", "Charlie", "Diana"),
age = c(25, 30, 35, 40),
city = c("Austin", "Denver", "Chicago", "Seattle"),
score = c(88, 92, 85, 95)`;

const rawOutput = [
	'name age city score',
	'Alice 25 Austin 88',
	'Bob 30 Denver 92',
	'Charlie 35 Chicago 85',
	'Diana 40 Seattle 95',
];
