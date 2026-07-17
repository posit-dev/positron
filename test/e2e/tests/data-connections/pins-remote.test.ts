/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename,
	enableDataConnections: true,
});

// Opt-in remote smoke test: point the pins driver at a real Connect server (e.g. pub.demo.posit.team)
// via env vars, read-only. It is skipped unless both vars are set, so it never runs in normal CI
// (which has no remote credentials) and never touches a shared server uninvited. It does no seeding.
//
// It lives here (not under tests/connect/, which the e2e-electron project ignores) and carries no
// Connect/Workbench lane tag, so it runs in the default e2e-electron lane where it can be invoked
// locally against a real server:
//   CONNECT_SERVER=https://pub.demo.posit.team CONNECT_API_KEY=<key> \
//     npx playwright test pins-remote --project e2e-electron
const CONNECT_SERVER = process.env.CONNECT_SERVER;
const CONNECT_API_KEY = process.env.CONNECT_API_KEY;

const connectionName = 'Remote Connect';
// A pin known to exist on the target server, addressed as owner/name. Owners are the top-level
// grouping in the tree; the pin is a leaf beneath its owner.
const ownerUsername = 'julia.silge';
const pinName = 'what-numbers-are-these';

test.describe('Data Connections - Posit Connect Pins (remote)', { tag: [tags.CONNECTIONS] }, () => {

	test('Browse a real Connect server and find a known pin', async function ({ app }) {
		test.skip(!CONNECT_SERVER || !CONNECT_API_KEY, 'Set CONNECT_SERVER and CONNECT_API_KEY to run this remote smoke test');
		test.slow();

		const { dataConnections } = app.workbench;

		await test.step('Add the Posit Connect Pins connection', async () => {
			await dataConnections.openDataConnectionsView();
			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Posit Connect Pins');
			await dataConnections.fillConnectionInputs({
				'Connection Name': connectionName,
				// The driver normalizes a bare host to https://, so either form of CONNECT_SERVER works.
				'Server URL': CONNECT_SERVER!,
				'API Key': CONNECT_API_KEY!,
			});
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);
		});

		await test.step(`Expand ${ownerUsername} and verify ${pinName} is listed`, async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode(ownerUsername);
			await dataConnections.expectNodeVisible(pinName);
		});
	});
});
