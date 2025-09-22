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

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Validate active session list in console matches active session list in session picker', async function ({ app, sessions }) {
		const { console } = app.positron;

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
			const { console, plots, variables } = app.positron;

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
});


async function runCodeInSession(app: Application, session: SessionMetaData, index: number) {
	await test.step(`${session.name}: run code to generate plot and variable`, async () => {
		const { sessions, console, variables } = app.positron;
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
