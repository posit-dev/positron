/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Kernel Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.SOFT_FAIL] // soft fail due to https://github.com/posit-dev/positron/issues/10546
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('ensure notebook session states update correctly during start, restart, and shutdown', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// create new notebook
		await notebooksPositron.newNotebook();

		// ensure when no kernel is selected, restart/shutdown are disabled
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Change Kernel', enabled: true },
			{ label: 'Open Notebook Console', enabled: false },
			{ label: 'Restart Kernel', enabled: false },
			{ label: 'Shutdown Kernel', enabled: false },
		]);

		// select kernel and ensure while starting, restart is enabled & shutdown is disabled
		await notebooksPositron.kernel.select('Python', { waitForReady: false });
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', enabled: true },
			{ label: 'Shutdown Kernel', enabled: false },
		]);

		// ensure once started and ready, shutdown is enabled
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'idle'
		});
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Shutdown Kernel', enabled: true },
		]);

		// restart kernel and ensure state changes
		await notebooksPositron.kernel.restart({ waitForRestart: false });
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'active'
		});
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'idle'
		});

		// shut down kernel and ensure menu options
		await notebooksPositron.kernel.shutdown();
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'disconnected'
		});
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', enabled: true },
			{ label: 'Shutdown Kernel', enabled: false },
			{ label: 'Change Kernel', enabled: true },
			{ label: 'Open Notebook Console', enabled: false },
		]);

		// re-start kernel from shutdown state and ensure state changes
		await notebooksPositron.kernel.restart();
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'idle'
		});
	});

	test('ensure variable and output persistence after kernel restart', async function ({ app }) {
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
		await notebooksPositron.expectOutputAtIndex(2, cellOutput);

		// verify execution orders
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
			{ index: 2, order: 3 },
		]);

		// restart kernel
		await notebooksPositron.kernel.restart({ waitForRestart: true });

		// verify variables are cleared
		await variables.expectVariableToNotExist('x');
		await variables.expectVariableToNotExist('y');

		// verify execution orders persist
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 },
			{ index: 1, order: 2 },
		]);

		// verify html cell output persists and remains unchanged
		await notebooksPositron.expectOutputAtIndex(2, cellOutput);

		// run cell 0 again and ensure execution order restarts at 1
		await notebooksPositron.runCodeAtIndex(1);
		await notebooksPositron.expectExecutionOrder([
			{ index: 0, order: 1 }, // from previous session (pre-reload)
			{ index: 1, order: 1 }, // from current session (post-reload)
			{ index: 2, order: 3 }, // from previous session (pre-reload)

		]);
	});

	test('ensure new notebooks use foreground session kernel', async function ({ app, sessions }) {
		const { notebooksPositron } = app.workbench;

		// start multiple sessions and select R
		const [, rSession] = await sessions.start(['python', 'r']);
		await sessions.select(rSession.id);

		// create new notebook and ensure R kernel is auto-selected (from foreground) and started
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'R',
			status: 'idle'
		});
	});

	test('ensure existing notebooks use their correct interpreter kernel', async function ({ app, sessions }) {
		const { notebooksPositron } = app.workbench;
		const pythonNotebook = path.join('workspaces', 'data-explorer-update-datasets', 'pandas-update-dataframe.ipynb');
		const rRnotebook = path.join('workspaces', 'r_notebooks', 'Introduction+to+R.ipynb');

		// start multiple sessions and select R
		const [, rSession] = await sessions.start(['python', 'r']);
		await sessions.select(rSession.id);

		// open existing python notebook and ensure python kernel is auto-selected (from background) and started
		await notebooksPositron.openNotebook(pythonNotebook);
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'Python',
			status: 'idle'
		});

		// open exiting R notebook and ensure R kernel is auto-selected (from foreground) and started
		await notebooksPositron.openNotebook(rRnotebook);
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'R',
			status: 'idle'
		});
	});

	test('ensure notebook console attaches and terminates with active kernel', async function ({ app, sessions }) {
		const { notebooksPositron, console } = app.workbench;

		const [, rSession] = await sessions.start(['python', 'r']);
		await sessions.select(rSession.id);

		// create new notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'R',
			status: 'idle'
		});

		// open notebook console and ensure appears in session list
		await notebooksPositron.kernel.openNotebookConsole();
		await sessions.expectSessionCountToBe(3);
		await sessions.expectStatusToBe('Untitled-1.ipynb', 'idle');

		// terminate notebook session
		await sessions.select('Untitled-1.ipynb');
		await console.pasteCodeToConsole('q()', true);

		// verify session is terminated in both kernel and sessions list
		await sessions.expectStatusToBe('Untitled-1.ipynb', 'disconnected');
		await notebooksPositron.kernel.expectKernelToBe({
			kernelGroup: 'R',
			status: 'disconnected'
		});
	});
});

const rDataFrame = `data.frame(
name = c("Alice", "Bob", "Charlie", "Diana"),
age = c(25, 30, 35, 40),
city = c("Austin", "Denver", "Chicago", "Seattle"),
score = c(88, 92, 85, 95)`;

const cellOutput = [
	'name age city score',
	'Alice 25 Austin 88',
	'Bob 30 Denver 92',
	'Charlie 35 Chicago 85',
	'Diana 40 Seattle 95',
];
