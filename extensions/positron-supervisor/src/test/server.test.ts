/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { API_INSTANCE } from '../extension';

// Basic test to ensure the server can start and return status, and is the
// correct version as specified in the package.json.
suite('Server', () => {
	// Ensure that the server connects even when the http_proxy environment
	// variable is set.
	//
	// NOTE: This test must run first because we only examine this value when
	// the server is started; subsequent tests will use the warm server. We
	// could improve this by adding some scaffolding to use a fresh server
	// instance for every test.
	test('Server connects when http_proxy is set', async () => {
		// Set the http_proxy environment variable to a non-existent proxy
		const oldHttpProxy = process.env.http_proxy;
		process.env.http_proxy = 'http://example.com:234';

		// Start the server and connect to it
		try {
			await API_INSTANCE.ensureStarted();
			const status = await API_INSTANCE.serverStatus();

			// Sanity check a response field
			assert.strictEqual(status.sessions, 0);
		} finally {
			// Reset the http_proxy environment variable
			process.env.http_proxy = oldHttpProxy;
		}
	});

	test('Server version is correct', async () => {

		// Start the server and connect to it
		await API_INSTANCE.ensureStarted();
		const status = await API_INSTANCE.serverStatus();

		// Read the package.json file to get the version
		const pkg = require('../../package.json');

		// Ensure the version that the server returned is the same as the
		// package.json version
		assert.strictEqual(status.version, pkg.positron.binaryDependencies.kallichore);
	});

});
