/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as http from 'http';
import * as net from 'net';
import { DatabricksLoopbackServer } from '../databricksAuthServer';

/** Find a free port by briefly binding an ephemeral listener. */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const port = (probe.address() as net.AddressInfo).port;
			probe.close(() => resolve(port));
		});
	});
}

function get(port: number, pathAndQuery: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		http.get(`http://127.0.0.1:${port}${pathAndQuery}`, res => {
			let body = '';
			res.on('data', chunk => { body += chunk; });
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
		}).on('error', reject);
	});
}

suite('DatabricksLoopbackServer', () => {
	let server: DatabricksLoopbackServer | undefined;

	teardown(async () => {
		await server?.stop();
		server = undefined;
	});

	test('resolves the code on a valid redirect', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/?code=auth-code-123&state=expected-state');

		assert.strictEqual(response.status, 200);
		assert.ok(response.body.includes('You are signed in to Databricks'));
		assert.strictEqual(await codePromise, 'auth-code-123');
	});

	test('accepts the redirect on any path', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/some/path?code=abc&state=expected-state');

		assert.strictEqual(response.status, 200);
		assert.strictEqual(await codePromise, 'abc');
	});

	test('responds 400 and rejects on a state mismatch', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/?code=auth-code-123&state=wrong-state');

		assert.strictEqual(response.status, 400);
		await assert.rejects(
			() => codePromise,
			(err: Error) => err.message.includes('state')
		);
	});

	test('rejects with the error description on an error redirect', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(
			port,
			'/?error=access_denied&error_description=User%20denied%20access&state=expected-state'
		);

		assert.strictEqual(response.status, 400);
		await assert.rejects(
			() => codePromise,
			(err: Error) => err.message === 'User denied access'
		);
	});

	test('start maps EADDRINUSE to a friendly error', async () => {
		const port = await getFreePort();
		// Pre-bind the port so start() fails.
		const blocker = net.createServer();
		await new Promise<void>((resolve, reject) => {
			blocker.once('error', reject);
			blocker.listen(port, '127.0.0.1', () => resolve());
		});

		try {
			server = new DatabricksLoopbackServer('expected-state', port);
			await assert.rejects(
				() => server!.start(),
				(err: Error) =>
					err.message.includes(`Port ${port} is already in use`) &&
					err.message.includes('personal access token')
			);
		} finally {
			await new Promise<void>(resolve => blocker.close(() => resolve()));
		}
	});

	test('waitForCode times out', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();

		await assert.rejects(
			() => server!.waitForCode(50),
			(err: Error) => err.message.includes('Timed out')
		);
	});

	test('stop is idempotent', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port);
		await server.start();
		await server.stop();
		await server.stop();
	});
});
