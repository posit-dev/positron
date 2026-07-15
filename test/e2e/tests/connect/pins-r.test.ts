/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

// The Connect API key resolved in beforeAll and injected into the R session so
// the pins board can authenticate.
let connectApiKey: string;
// Connect's URL as seen from the R session, resolved in beforeAll. The local
// electron run (with-connect) publishes Connect on localhost:3939; the Workbench
// web run has R in a container on the compose network reaching `connect:3939`.
let connectServer!: string;

test.describe('Pins - R', { tag: [tags.WORKBENCH, tags.CONNECT] }, () => {

	test.beforeAll('Get connect API key', async function ({ app, runDockerCommand }) {

		// Local electron run (with-connect) vs the Workbench web run.
		const isLocal = test.info().project.name === 'e2e-connect';
		connectServer = isLocal ? 'http://localhost:3939' : 'http://connect:3939';

		// Skip the suite when Connect isn't up (e.g. the full local suite is run
		// without the local Connect started).
		test.skip(!(await app.workbench.positConnect.isReachable()), 'Posit Connect is not reachable at http://localhost:3939');

		// Resolve the publisher API key: env -> local token file -> Workbench volume.
		connectApiKey = await app.workbench.positConnect.resolveApiKey(isLocal ? undefined : runDockerCommand);
		app.workbench.positConnect.setConnectApiKey(connectApiKey);

		if (!(await app.workbench.positConnect.isApiKeyValid())) {
			throw new Error('Connect API key did not authenticate against http://localhost:3939');
		}
	});

	test('Publish pins with dummy data and query their contents', async function ({ app, r, executeCode }) {

		test.slow();

		const { console } = app.workbench;

		await test.step('Point the R session at Connect', async () => {
			// Set the env vars that pins::board_connect() reads by default. Passing
			// them via the session (rather than baking the key into the script) keeps
			// the credential out of the workspace file.
			await executeCode(
				'R',
				`Sys.setenv(CONNECT_SERVER = ${JSON.stringify(connectServer)}, CONNECT_API_KEY = ${JSON.stringify(connectApiKey)})`
			);
		});

		await test.step('Run the publish script', async () => {
			// Source with chdir so relative paths inside the script resolve, and use
			// an absolute path so the working directory of the session doesn't matter.
			const scriptPath = join(app.workspacePathOrFolder, 'workspaces', 'connect-pins-r', 'publish-pins.R');
			await executeCode('R', `source(${JSON.stringify(scriptPath)}, chdir = TRUE)`, { timeout: 120000 });
		});

		await test.step('Verify both pins were published', async () => {
			await console.waitForConsoleContents('Published pin: e2e-mtcars', { timeout: 60000 });
			await console.waitForConsoleContents('Published pin: e2e-iris', { timeout: 60000 });
		});

		await test.step('Verify the queried pin tables were logged to the console', async () => {
			// Column headers printed by print(pin_read(...)) prove the round trip
			// returned the dummy data frames we published.
			await console.waitForConsoleContents('mpg', { timeout: 60000 });
			await console.waitForConsoleContents('Sepal.Length', { timeout: 60000 });
			await console.waitForConsoleContents('PINS PUBLISH COMPLETE', { timeout: 60000 });
		});
	});
});
