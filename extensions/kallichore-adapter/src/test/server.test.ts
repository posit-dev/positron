/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { API_INSTANCE } from '../extension';

// Basic test to ensure the server can start and return status, and is the
// correct version as specified in the package.json.
suite('Server', () => {
	test('Server starts and connects', async () => {
		// Skip this test if the server is not available (see notes in `install-kallichore-server.ts`)
		if (process.env.GITHUB_ACTIONS && process.env.GITHUB_REPOSITORY === 'posit-dev/positron') {
			// Skip the test
			return;
		}

		// Start the server and connect to it
		const status = await API_INSTANCE.serverStatus();

		// Read the package.json file to get the version
		const pkg = require('../../package.json');

		// Ensure the version that the server returned is the same as the
		// package.json version
		assert.strictEqual(status.version, pkg.positron.binaryDependencies.kallichore);
	});
});
