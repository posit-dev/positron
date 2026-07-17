/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename,
	enableDataConnections: true,
});

const connectionName = 'e2e Connect Pins';

// The pins the seed script publishes, both stored as rds, listed sorted by name (owner nodes list
// their pins alphabetically).
const seededPins = ['e2e-iris', 'e2e-mtcars'];

// The Connect API key resolved in beforeAll and used both to seed pins (via the R session) and to
// configure the Data Connections driver.
let connectApiKey: string;
// Connect's URL as seen from the session: the local electron run (with-connect) publishes Connect
// on localhost:3939; the Workbench web run reaches it as `connect:3939` on the compose network.
let connectServer: string;
// The publisher's username, which is the owner node the seeded pins live under in the tree.
let ownerUsername: string;

test.describe('Data Connections - Posit Connect Pins', { tag: [tags.WORKBENCH, tags.CONNECT, tags.CONNECTIONS] }, () => {

	test.beforeAll('Resolve Connect credentials', async function ({ app, runDockerCommand }) {
		const isLocal = test.info().project.name === 'e2e-connect';
		connectServer = isLocal ? 'http://localhost:3939' : 'http://connect:3939';

		// Skip the suite when Connect isn't up (e.g. the full local suite run without local Connect).
		test.skip(!(await app.workbench.positConnect.isReachable()), 'Posit Connect is not reachable at http://localhost:3939');

		connectApiKey = await app.workbench.positConnect.resolveApiKey(isLocal ? undefined : runDockerCommand);
		app.workbench.positConnect.setConnectApiKey(connectApiKey);
		if (!(await app.workbench.positConnect.isApiKeyValid())) {
			throw new Error('Connect API key did not authenticate against http://localhost:3939');
		}
		ownerUsername = await app.workbench.positConnect.getCurrentUsername();
	});

	test('Add a Connect server and browse its pins in the tree', async function ({ app, r, executeCode }) {
		test.slow();
		const { console, dataConnections } = app.workbench;

		await test.step('Seed pins by publishing dummy data with the R pins package', async () => {
			// board_connect() reads these env vars; set them on the session rather than baking the key
			// into the script.
			await executeCode(
				'R',
				`Sys.setenv(CONNECT_SERVER = ${JSON.stringify(connectServer)}, CONNECT_API_KEY = ${JSON.stringify(connectApiKey)})`
			);
			const scriptPath = join(app.workspacePathOrFolder, 'workspaces', 'connect-pins-r', 'publish-pins.R');
			await executeCode('R', `source(${JSON.stringify(scriptPath)}, chdir = TRUE)`, { timeout: 120000 });
			await console.waitForConsoleContents('PINS PUBLISH COMPLETE', { timeout: 60000 });
		});

		await test.step('Add the Posit Connect Pins connection', async () => {
			await dataConnections.openDataConnectionsView();
			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Posit Connect Pins');
			await dataConnections.fillConnectionInputs({
				'Connection Name': connectionName,
				'Server URL': connectServer,
				'API Key': connectApiKey,
			});
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);
		});

		await test.step('Expand to the owner and verify the seeded pins are listed', async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode(ownerUsername);
			for (const pin of seededPins) {
				await dataConnections.expectNodeVisible(pin);
			}
		});
	});
});
