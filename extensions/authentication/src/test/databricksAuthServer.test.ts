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
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/?code=auth-code-123&state=expected-state');

		assert.strictEqual(response.status, 200);
		assert.ok(response.body.includes('You are signed in to Databricks'));
		assert.strictEqual(await codePromise, 'auth-code-123');
	});

	test('accepts the redirect on any path', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/some/path?code=abc&state=expected-state');

		assert.strictEqual(response.status, 200);
		assert.strictEqual(await codePromise, 'abc');
	});

	test('responds 400 and rejects on a state mismatch', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
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
		server = new DatabricksLoopbackServer('expected-state', port, port);
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

	test('rejects an error redirect that does not carry the expected state', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(port, '/?error=access_denied&state=wrong-state');

		assert.strictEqual(response.status, 400);
		await assert.rejects(
			() => codePromise,
			(err: Error) => err.message.includes('state')
		);
	});

	test('escapes the error description in the response body', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();

		const codePromise = server.waitForCode(5000);
		const response = await get(
			port,
			'/?error=bad&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&state=expected-state'
		);

		assert.strictEqual(response.status, 400);
		assert.ok(!response.body.includes('<img'));
		assert.ok(response.body.includes('&lt;img'));
		await assert.rejects(() => codePromise, (err: Error) => err.message.includes('<img'));
	});

	test('falls back to the next port when the first is busy', async () => {
		const portA = await getFreePort();
		// Occupy portA so the server must fall back to portA+1... within range.
		const blocker = net.createServer();
		await new Promise<void>((resolve, reject) => {
			blocker.once('error', reject);
			blocker.listen(portA, '127.0.0.1', () => resolve());
		});
		try {
			server = new DatabricksLoopbackServer('expected-state', portA, portA + 5);
			await server.start();
			assert.notStrictEqual(server.port, portA);
			assert.ok(server.port > portA && server.port <= portA + 5);
			const codePromise = server.waitForCode(5000);
			const response = await get(server.port, '/?code=abc&state=expected-state');
			assert.strictEqual(response.status, 200);
			assert.strictEqual(await codePromise, 'abc');
		} finally {
			await new Promise<void>(resolve => blocker.close(() => resolve()));
		}
	});

	test('falls back to the next port when only ::1 is busy on the first', async function () {
		const portA = await getFreePort();
		// Occupy ::1 on portA specifically, leaving 127.0.0.1:portA free, so
		// start() must treat portA as unusable and move on rather than
		// failing the whole scan.
		const blocker = net.createServer();
		try {
			await new Promise<void>((resolve, reject) => {
				blocker.once('error', reject);
				blocker.listen(portA, '::1', () => resolve());
			});
		} catch {
			this.skip(); // Host has no usable ::1.
			return;
		}
		try {
			server = new DatabricksLoopbackServer('expected-state', portA, portA + 5);
			await server.start();
			assert.notStrictEqual(server.port, portA);
			assert.ok(server.port > portA && server.port <= portA + 5);
			const codePromise = server.waitForCode(5000);
			const response = await get(server.port, '/?code=abc&state=expected-state');
			assert.strictEqual(response.status, 200);
			assert.strictEqual(await codePromise, 'abc');
		} finally {
			await new Promise<void>(resolve => blocker.close(() => resolve()));
		}
	});

	test('rejects when every port in the range is busy', async () => {
		const portA = await getFreePort();
		const blocker = net.createServer();
		await new Promise<void>((resolve, reject) => {
			blocker.once('error', reject);
			blocker.listen(portA, '127.0.0.1', () => resolve());
		});
		try {
			server = new DatabricksLoopbackServer('expected-state', portA, portA);
			await assert.rejects(
				() => server!.start(),
				(err: Error) => err.message.includes('No free port')
			);
		} finally {
			await new Promise<void>(resolve => blocker.close(() => resolve()));
		}
	});

	test('redirectUri names localhost with the bound port and no trailing slash', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();
		assert.strictEqual(server.redirectUri, `http://localhost:${port}`);
	});

	test('port and redirectUri throw before start', () => {
		const s = new DatabricksLoopbackServer('expected-state');
		assert.throws(() => s.port);
		assert.throws(() => s.redirectUri);
	});

	test('accepts the redirect over IPv6 when ::1 bound', async function () {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();
		if (!server.ipv6Bound) {
			this.skip(); // Host has no usable ::1.
		}
		const codePromise = server.waitForCode(5000);
		const response = await new Promise<{ status: number }>((resolve, reject) => {
			http.get(`http://[::1]:${port}/?code=v6&state=expected-state`, res => {
				res.resume();
				resolve({ status: res.statusCode ?? 0 });
			}).on('error', reject);
		});
		assert.strictEqual(response.status, 200);
		assert.strictEqual(await codePromise, 'v6');
	});

	test('waitForCode times out', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();

		await assert.rejects(
			() => server!.waitForCode(50),
			(err: Error) => err.message.includes('Timed out')
		);
	});

	test('stop is idempotent', async () => {
		const port = await getFreePort();
		server = new DatabricksLoopbackServer('expected-state', port, port);
		await server.start();
		await server.stop();
		await server.stop();
	});
});
