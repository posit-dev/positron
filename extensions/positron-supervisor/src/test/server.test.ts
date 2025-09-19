/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import { API_INSTANCE } from '../extension';
import { KCApi } from '../KallichoreAdapterApi';
import { KallichoreTransport } from '../KallichoreApiInstance';

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

// Test suite for different transport types
suite('Server Transport Types', () => {

	test('TCP transport', async function () {
		this.timeout(30000); // TCP transport may take time to start

		// Get the extension context from the existing API_INSTANCE
		const context = (API_INSTANCE as any)._context;
		const log = vscode.window.createOutputChannel('Test TCP Transport');

		// Create a KCApi instance with forced TCP transport
		const tcpApiInstance = new KCApi(context, log, KallichoreTransport.TCP, false);

		try {
			// Start the server with TCP transport
			await tcpApiInstance.ensureStarted();

			// Verify the server is actually running and responding
			const status = await tcpApiInstance.serverStatus();

			// Basic server functionality
			assert.strictEqual(typeof status.sessions, 'number');
			assert.strictEqual(typeof status.version, 'string');
			assert.ok(status.sessions >= 0);
			assert.ok(status.version.length > 0);

			// Verify the transport is actually TCP by checking the API instance
			const apiInstance = tcpApiInstance as any;
			assert.strictEqual(apiInstance._api.transport, KallichoreTransport.TCP);

			// Test that we can make multiple API calls successfully
			const status2 = await tcpApiInstance.serverStatus();
			assert.strictEqual(status2.sessions, status.sessions);
			assert.strictEqual(status2.version, status.version);

		} finally {
			// Clean up
			tcpApiInstance.dispose();
			log.dispose();
		}
	});

	test('Unix socket transport', async function () {
		// Skip on Windows since this is specifically testing Unix sockets
		if (os.platform() === 'win32') {
			this.skip();
			return;
		}

		this.timeout(30000);

		// Get the extension context from the existing API_INSTANCE
		const context = (API_INSTANCE as any)._context;
		const log = vscode.window.createOutputChannel('Test Unix Socket Transport');

		// Create a KCApi instance with forced Unix socket transport
		const socketApiInstance = new KCApi(context, log, KallichoreTransport.UnixSocket, false);

		try {
			// Start the server with Unix socket transport
			await socketApiInstance.ensureStarted();

			// Verify the server is actually running and responding
			const status = await socketApiInstance.serverStatus();

			// Basic server functionality
			assert.strictEqual(typeof status.sessions, 'number');
			assert.strictEqual(typeof status.version, 'string');
			assert.ok(status.sessions >= 0);
			assert.ok(status.version.length > 0);

			// Verify the transport is actually Unix socket
			const apiInstance = socketApiInstance as any;
			assert.strictEqual(apiInstance._api.transport, KallichoreTransport.UnixSocket);

		} finally {
			// Clean up
			socketApiInstance.dispose();
			log.dispose();
		}
	});

	test('Named pipe transport', async function () {
		// Skip on non-Windows since this is specifically testing named pipes
		if (os.platform() !== 'win32') {
			this.skip();
			return;
		}

		this.timeout(30000);

		// Get the extension context from the existing API_INSTANCE
		const context = (API_INSTANCE as any)._context;
		const log = vscode.window.createOutputChannel('Test Named Pipe Transport');

		// Create a KCApi instance with forced named pipe transport
		const pipeApiInstance = new KCApi(context, log, KallichoreTransport.NamedPipe, false);

		try {
			// Start the server with named pipe transport
			await pipeApiInstance.ensureStarted();

			// Verify the server is actually running and responding
			const status = await pipeApiInstance.serverStatus();

			// Basic server functionality
			assert.strictEqual(typeof status.sessions, 'number');
			assert.strictEqual(typeof status.version, 'string');
			assert.ok(status.sessions >= 0);
			assert.ok(status.version.length > 0);

			// Verify the transport is actually named pipe
			const apiInstance = pipeApiInstance as any;
			assert.strictEqual(apiInstance._api.transport, KallichoreTransport.NamedPipe);

		} finally {
			// Clean up
			pipeApiInstance.dispose();
			log.dispose();
		}
	});
});
