/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { Application, SessionMetaData } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Management', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS, tags.CRITICAL]
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app, sessions }) {
		const { console, variables } = app.workbench;

		// Ensure sessions exist and are idle
		const [pySession, pySessionAlt, rSession] = await sessions.start(['python', 'pythonAlt', 'r']);

		// Set and verify variables in Python Session 1
		await sessions.select(pySession.id);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.expectRuntimeToBe('visible', pySession.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in Python Session 2
		await sessions.select(pySessionAlt.id);
		await console.typeToConsole('x = 11', true);
		await console.typeToConsole('y = 22', true);
		await variables.expectRuntimeToBe('visible', pySessionAlt.name);
		await variables.expectVariableToBe('x', '11');
		await variables.expectVariableToBe('y', '22');

		// Set and verify variables in R
		await sessions.select(rSession.id);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.expectRuntimeToBe('visible', rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pySession.id);
		await console.typeToConsole('x = 0', true);
		await variables.expectRuntimeToBe('visible', pySession.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession.id);
		await variables.expectRuntimeToBe('visible', rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});

	test('Validate session list is scrollable', async function ({ sessions }) {
		// @ts-ignore need a couple sessions for scrolling
		const [pySession, pySessionAlt] = await sessions.start(['python', 'pythonAlt']);

		// Resize window to force scrolling
		// Move the divider to be 100px above the bottom
		await sessions.setSessionDividerAboveBottom(100);
		await sessions.expectSessionListToBeScrollable({ horizontal: false, vertical: true });
		await sessions.setSessionDividerAboveBottom(500);

		// Cleaning up since next test only needs 2 sessions
		await sessions.delete(pySessionAlt.id);
	});

	test('Validate active session list in console matches active session list in session picker', async function ({ app, sessions }) {
		const { console } = app.workbench;

		// Start sessions and verify active sessions: order matters!
		const [pySession, rSession] = await sessions.start(['python', 'r']);
		await sessions.expectSessionCountToBe(2, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown Python session and verify active sessions
		await sessions.select(pySession.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown R session and verify active sessions
		await sessions.select(rSession.name);
		await console.typeToConsole('q()', true);
		await sessions.expectSessionCountToBe(0, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Launch Python session (again) and verify active sessions
		await sessions.deleteDisconnectedSessions();
		await sessions.start('python');
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();
	});

	test.skip('Validate session, console, variables, and plots persist after reload',
		{
			tag: [tags.VARIABLES, tags.PLOTS],
			annotation: [
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6036' },
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6843' } // <-- main issue for the test, session do not consistently restore
			]
		}, async function ({ app, sessions, runCommand }) {
			const { console, plots, variables } = app.workbench;

			// Ensure sessions exist and are idle
			const [pySession, rSession, pySession2] = await sessions.start(['python', 'r', 'python']);

			await sessions.expectSessionCountToBe(3);
			await sessions.expectAllSessionsToBeReady();

			// Select R session and run script to generate plot and variable
			await runCodeInSession(app, rSession, 1,);
			await plots.waitForCurrentPlot();
			await console.waitForConsoleContents('[1] "this is console 1"');
			await variables.expectVariableToBe('test', '1');

			// Select Python session 1 and run script to generate plot and variable
			await runCodeInSession(app, pySession, 2);
			await plots.waitForCurrentPlot();
			await plots.expectPlotThumbnailsCountToBe(2);
			await console.waitForConsoleContents('this is console 2', { exact: true });
			await variables.expectVariableToBe('test', '2');

			// Select Python session 1b (same runtime) and run script to generate plot and variable
			await runCodeInSession(app, pySession2, 3);
			await plots.expectPlotThumbnailsCountToBe(3);
			await console.waitForConsoleContents('this is console 3', { exact: true });
			await variables.expectVariableToBe('test', '3');

			// Reload app
			await runCommand('workbench.action.reloadWindow');

			// Verify all sessions reload and are idle
			await sessions.expectSessionCountToBe(3);
			await sessions.expectAllSessionsToBeReady();

			// Verify sessions, plot, console history, and variables persist for R session
			await sessions.select(rSession.id);
			await variables.expectVariableToBe('test', '1');
			await console.waitForConsoleContents('[1] "this is console 1"');
			await plots.waitForCurrentPlot();
			// await plots.expectPlotThumbnailsCountToBe(3);  // issue 6036

			// Verify sessions, plot, console history, and variables persist for Python session
			await sessions.select(pySession.id);
			await variables.expectVariableToBe('test', '2');
			await console.waitForConsoleContents('this is console 2', { exact: true });
			await plots.waitForCurrentPlot();
			// await plots.expectPlotThumbnailsCountToBe(3); // issue 6036

			await sessions.select(pySession2.id);
			await variables.expectVariableToBe('test', '3');
			await console.waitForConsoleContents('this is console 3', { exact: true });
			await plots.waitForCurrentPlot();
			// await plots.expectPlotThumbnailsCountToBe(3); // issue 6036
		});

	test('Validate sessions are keyboard accessible', {
		tag: [tags.ACCESSIBILITY],
	}, async function ({ sessions, page }) {
		const [pySession, rSession, pySession2] = await sessions.start(['python', 'r', 'python']);
		const newSessionName = 'This is a test';

		// Rename first session via keyboard actions
		await sessions.sessionTabs.first().click();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await page.keyboard.type(newSessionName);
		await page.keyboard.press('Enter');

		// Verify session name has been updated
		await sessions.expectSessionNameToBe(pySession.id, pySession.name);
		await sessions.expectSessionNameToBe(rSession.id, newSessionName);
		await sessions.expectSessionNameToBe(pySession2.id, pySession2.name);

		// Verify able to delete sessions via keyboard actions
		await sessions.expectSessionCountToBe(3);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Enter');
		await sessions.expectSessionCountToBe(2);
	});
});


async function runCodeInSession(app: Application, session: SessionMetaData, index: number) {
	await test.step(`${session.name}: run code to generate plot and variable`, async () => {
		const { sessions, console, variables } = app.workbench;
		const isPython = session.name.includes('Python');
		await sessions.select(session.id);

		// Generate an image plot
		const imagePlotScript = isPython
			? `import matplotlib.pyplot as plt
import numpy as np
img = np.random.rand(10, 10)
plt.imshow(img, cmap='gray')
plt.axis('off')
plt.show()`
			: `library(ggplot2)
library(grid)
img <- matrix(runif(100), nrow=10)
grid.raster(img)`;
		await console.executeCode(isPython ? 'Python' : 'R', imagePlotScript);

		// Print index to console
		await console.typeToConsole(`print("this is console ${index}")`, true);

		// Assign a variable based on session language
		const assignment = isPython
			? `test = ${index}`
			: `test <- ${index}`;
		await console.typeToConsole(assignment, true);

		await variables.focusVariablesView();
	});
}
