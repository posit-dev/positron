/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { Application, pythonSession, pythonSessionAlt, rSession, SessionInfo } from '../../infra';
import { expect } from '@playwright/test';

const pythonSession1: SessionInfo = { ...pythonSession };
// const pythonSession1b: SessionInfo = { ...pythonSession };
const pythonSession2: SessionInfo = { ...pythonSessionAlt };
const rSession1: SessionInfo = { ...rSession };

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
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		pythonSession2.id = await sessions.reuseIdleSessionIfExists(pythonSession2);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Set and verify variables in Python Session 1
		await sessions.select(pythonSession1.id);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in Python Session 2
		await sessions.select(pythonSession2.id);
		await console.typeToConsole('x = 11', true);
		await console.typeToConsole('y = 22', true);
		await variables.expectRuntimeToBe('visible', pythonSession2.name);
		await variables.expectVariableToBe('x', '11');
		await variables.expectVariableToBe('y', '22');

		// Set and verify variables in R
		await sessions.select(rSession1.id);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pythonSession1.id);
		await console.typeToConsole('x = 0', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession1.id);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});

	test('Validate session list is scrollable', async function ({ app }) {
		const sessions = app.workbench.sessions;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		pythonSession2.id = await sessions.reuseIdleSessionIfExists(pythonSession2);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Resize window to force scrolling
		// Move the divider to be 100px above the bottom
		await sessions.setSessionDividerAboveBottom(100);
		await sessions.expectSessionListToBeScrollable({ horizontal: false, vertical: true });
		await sessions.setSessionDividerAboveBottom(500);

		// Cleaning up since next test only needs 2 sessions
		await sessions.delete(pythonSession2.id);
	});

	test('Validate active session list in console matches active session list in session picker', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start sessions and verify active sessions: order matters!
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);
		await sessions.expectSessionCountToBe(2, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown Python session and verify active sessions
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown R session and verify active sessions
		await sessions.select(rSession1.name);
		await console.typeToConsole('q()', true);
		await sessions.expectSessionCountToBe(0, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Launch Python session (again) and verify active sessions
		await sessions.deleteDisconnectedSessions();
		await sessions.launch(pythonSession1);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();
	});

	test('Validate can delete sessions', { tag: [tags.VARIABLES] }, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const variables = app.workbench.variables;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Delete 1st session and verify active sessions and runtime in session picker
		await sessions.delete(pythonSession1.id);
		await sessions.expectSessionCountToBe(1);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('visible', rSession1.name);

		// Delete 2nd session and verify no active sessions or runtime in session picker
		await console.barTrashButton.click();
		await expect(sessions.activeSessionPicker).toHaveText('Start Session');
		await sessions.expectSessionCountToBe(0);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('not.visible', `${rSession1.name}|${pythonSession1.name}|None`);
	});

	test('Validate session, console, variables, and plots persist after reload',
		{
			tag: [tags.VARIABLES, tags.PLOTS],
			annotation: [
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6036' },
				{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6725' }]
		}, async function ({ app, runCommand }) {
			const { sessions, console, plots, variables } = app.workbench;

			// Ensure sessions exist and are idle
			pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
			rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);
			// pythonSession1b.id = await sessions.launch(pythonSession1b);
			await sessions.expectSessionCountToBe(2);
			await sessions.expectAllSessionsToBeIdle();

			// Select R session and run script to generate plot and variable
			await runCodeInSession(app, rSession1, 1);
			await plots.waitForCurrentPlot();
			await console.waitForConsoleContents('[1] "this is console 1"');
			await variables.expectVariableToBe('test', '1');

			// Select Python session 1 and run script to generate plot and variable
			await runCodeInSession(app, pythonSession1, 2);
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
			await sessions.expectSessionCountToBe(2);
			await sessions.expectAllSessionsToBeIdle();
			// await plots.expectPlotThumbnailsCountToBe(3); // issue 6035: only 1 plot is shown

			// Verify sessions, plot, console history, and variables persist for each session
			await sessions.select(rSession1.id);
			await variables.expectVariableToBe('test', '1');
			await console.waitForConsoleContents('[1] "this is console 1"');

			await sessions.select(pythonSession1.id);
			await variables.expectVariableToBe('test', '2');
			await console.waitForConsoleContents('this is console 2', { exact: true });

			// issue 6725: uncomment below lines after issue is fixed
			// await sessions.select(pythonSession1b.id);
			// await variables.expectVariableToBe('test', '3');
			// await console.waitForConsoleContents('this is console 3', { exact: true });
		});
});

function pythonScript(num: number): string {
	return `import pandas as pd
import plotly.express as px
df = pd.DataFrame({'x': [1, 2, 3, 4], 'y': [10, 20, 25, 30]})
fig = px.line(df, x='x', y='y', title="Plot ${num}")
fig.show()`;
}

function rScript(num: number): string {
	return `library(ggplot2)
df <- data.frame(x = c(1, 2, 3, 4), y = c(10, 20, 25, 30))
ggplot(df, aes(x = x, y = y)) + geom_line() + ggtitle("Plot ${num}")`;
}

function printScript(num: number): string {
	return `print("this is console ${num}")`;
}

async function runCodeInSession(app: Application, session: SessionInfo, index: number) {
	await test.step(`${session.name}: run code to generate plot and variable`, async () => {
		const { sessions, console } = app.workbench;
		await sessions.select(session.id);

		// Determine script function based on session language
		const script = session.language === 'R' ? rScript : pythonScript;

		await console.executeCode(session.language, script(index));
		await console.typeToConsole(printScript(index), true);

		// Assign a variable based on session language
		const assignment = session.language === 'R' ? `test <- ${index}` : `test = ${index}`;
		await console.typeToConsole(assignment, true);
	});
}
