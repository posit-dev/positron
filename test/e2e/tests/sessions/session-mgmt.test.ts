/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { Application, SessionInfo } from '../../infra';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Management', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.sessions.deleteDisconnectedSessions();
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app, sessions }) {
		const { sessions: session, console, variables } = app.workbench;

		// Ensure sessions exist and are idle
		const [pythonSession1, pythonSession2, rSession1] = await sessions.start(['python', 'pythonAlt', 'r']);

		// Set and verify variables in Python Session 1
		await session.select(pythonSession1.id);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in Python Session 2
		await session.select(pythonSession2.id);
		await console.typeToConsole('x = 11', true);
		await console.typeToConsole('y = 22', true);
		await variables.expectRuntimeToBe('visible', pythonSession2.name);
		await variables.expectVariableToBe('x', '11');
		await variables.expectVariableToBe('y', '22');

		// Set and verify variables in R
		await session.select(rSession1.id);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await session.select(pythonSession1.id);
		await console.typeToConsole('x = 0', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await session.select(rSession1.id);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});

	test('Validate session list is scrollable', async function ({ app, sessions }) {
		const session = app.workbench.sessions;

		// @ts-ignore need a couple sessions for scrolling
		const [pythonSession1, pythonSession2] = await sessions.start(['python', 'pythonAlt', 'python']);

		// Resize window to force scrolling
		// Move the divider to be 100px above the bottom
		await session.setSessionDividerAboveBottom(100);
		await session.expectSessionListToBeScrollable({ horizontal: false, vertical: true });
		await session.setSessionDividerAboveBottom(500);

		// Cleaning up since next test only needs 2 sessions
		await session.delete(pythonSession2.id);
	});

	test('Validate active session list in console matches active session list in session picker', async function ({ app, sessions }) {
		const { sessions: session, console } = app.workbench;

		// Start sessions and verify active sessions: order matters!
		const [pythonSession1, rSession1] = await sessions.start(['python', 'r']);
		await session.expectSessionCountToBe(2, 'active');
		await session.expectActiveSessionListsToMatch();

		// Shutdown Python session and verify active sessions
		await session.select(pythonSession1.name);
		await console.typeToConsole('exit()', true);
		await session.expectSessionCountToBe(1, 'active');
		await session.expectActiveSessionListsToMatch();

		// Shutdown R session and verify active sessions
		await session.select(rSession1.name);
		await console.typeToConsole('q()', true);
		await session.expectSessionCountToBe(0, 'active');
		await session.expectActiveSessionListsToMatch();

		// Launch Python session (again) and verify active sessions
		await session.deleteDisconnectedSessions();
		await session.launch(pythonSession1);
		await session.expectSessionCountToBe(1, 'active');
		await session.expectActiveSessionListsToMatch();
	});

	test('Validate can delete sessions', { tag: [tags.VARIABLES] }, async function ({ app, sessions }) {
		const { sessions: session, console, variables } = app.workbench;

		// Ensure sessions exist and are idle
		const [pythonSession1, rSession1] = await sessions.start(['python', 'r']);

		// Delete 1st session and verify active sessions and runtime in session picker
		await session.delete(pythonSession1.id);
		await session.expectSessionCountToBe(1);
		await session.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('visible', rSession1.name);

		// Delete 2nd session and verify no active sessions or runtime in session picker
		await console.barTrashButton.click();
		await expect(session.activeSessionPicker).toHaveText('Start Session');
		await session.expectSessionCountToBe(0);
		await session.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('not.visible', `${rSession1.name}|${pythonSession1.name}|None`);
	});

	test('Validate session, console, variables, and plots persist after reload',
		{
			tag: [tags.VARIABLES, tags.PLOTS],
			annotation: [
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6036' },
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6725' }]
		}, async function ({ app, sessions, runCommand }) {
			const { sessions: session, console, plots, variables } = app.workbench;

			// Ensure sessions exist and are idle
			const [pythonSession1, rSession1] = await sessions.start(['python', 'r']);

			// pythonSession1b.id = await sessions.launch(pythonSession1b);
			await session.expectSessionCountToBe(2);
			await session.expectAllSessionsToBeIdle();

			// Select R session and run script to generate plot and variable
			await runCodeInSession(app, rSession1, 1,);
			await plots.waitForCurrentPlot();
			await console.waitForConsoleContents('[1] "this is console 1"');
			await variables.expectVariableToBe('test', '1');

			// Select Python session 1 and run script to generate plot and variable
			await runCodeInSession(app, pythonSession1, 2);
			await plots.waitForCurrentPlot();
			await plots.expectPlotThumbnailsCountToBe(2);
			await console.waitForConsoleContents('this is console 2', { exact: true });
			await variables.expectVariableToBe('test', '2');

			// issue 6725: uncomment below lines after issue is fixed
			// Select Python session 1b (same runtime) and run script to generate plot and variable
			// await runCodeInSession(app, pythonSession1b, 3);
			// await plots.expectPlotThumbnailsCountToBe(3);
			// await console.waitForConsoleContents('this is console 3', { exact: true });
			// await variables.expectVariableToBe('test', '3');

			// Reload app
			await runCommand('workbench.action.reloadWindow');

			// Verify all sessions reload and are idle
			await session.expectSessionCountToBe(2);
			await session.expectAllSessionsToBeIdle();

			// Verify sessions, plot, console history, and variables persist for R session
			await session.select(rSession1.id);
			await variables.expectVariableToBe('test', '1');
			await console.waitForConsoleContents('[1] "this is console 1"');
			await plots.waitForCurrentPlot();
			await plots.expectPlotThumbnailsCountToBe(2);

			// Verify sessions, plot, console history, and variables persist for Python session
			await session.select(pythonSession1.id);
			await variables.expectVariableToBe('test', '2');
			await console.waitForConsoleContents('this is console 2', { exact: true });
			await plots.waitForCurrentPlot();
			await plots.expectPlotThumbnailsCountToBe(2);

			// issue 6725: uncomment below lines after issue is fixed
			// await session.select(pythonSession1b.id);
			// await variables.expectVariableToBe('test', '3');
			// await console.waitForConsoleContents('this is console 3', { exact: true });
		});
});


async function runCodeInSession(app: Application, session: SessionInfo, index: number) {
	await test.step(`${session.name}: run code to generate plot and variable`, async () => {
		const { sessions, console, variables } = app.workbench;
		await sessions.select(session.id);

		// Generate an image plot
		const imagePlotScript = session.language === 'R'
			? `library(ggplot2)
library(grid)
img <- matrix(runif(100), nrow=10)
grid.raster(img)`
			: `import matplotlib.pyplot as plt
import numpy as np
img = np.random.rand(10, 10)
plt.imshow(img, cmap='gray')
plt.axis('off')
plt.show()`;
		await console.executeCode(session.language, imagePlotScript);

		// Print index to console
		await console.typeToConsole(`print("this is console ${index}")`, true);

		// Assign a variable based on session language
		const assignment = session.language === 'R' ? `test <- ${index}` : `test = ${index}`;
		await console.typeToConsole(assignment, true);

		await variables.focusVariablesView();
	});
}
