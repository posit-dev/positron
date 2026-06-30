/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as http from 'http';
import { McpServer } from '../mcpServer';
import { fakeExtensionContext } from './testUtils';

// One real HTTP roundtrip to prove the Express app, security middleware, and
// routes are wired together. Everything else is tested in-process.
suite('McpServer HTTP transport (smoke)', () => {
	const TEST_PORT = 43199;
	let server: McpServer;
	let previousPort: string | undefined;

	suiteSetup(async () => {
		previousPort = process.env.POSITRON_MCP_PORT;
		process.env.POSITRON_MCP_PORT = String(TEST_PORT);
		server = new McpServer(fakeExtensionContext());
		await server.start();
	});

	suiteTeardown(() => {
		server.dispose();
		if (previousPort === undefined) {
			delete process.env.POSITRON_MCP_PORT;
		} else {
			process.env.POSITRON_MCP_PORT = previousPort;
		}
	});

	function post(body: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; text: string }> {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify(body);
			const req = http.request({
				host: '127.0.0.1',
				port: TEST_PORT,
				path: '/',
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...extraHeaders },
			}, res => {
				let text = '';
				res.on('data', chunk => { text += chunk; });
				res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
			});
			req.on('error', reject);
			req.write(data);
			req.end();
		});
	}

	test('serves an initialize request', async () => {
		const { status, text } = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		assert.strictEqual(status, 200);
		assert.ok(JSON.parse(text).result, 'response carries a result');
	});

	test('acknowledges a notification with 202 and no body', async () => {
		const { status, text } = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
		assert.strictEqual(status, 202);
		assert.strictEqual(text, '');
	});

	test('rejects a disallowed origin with 403', async () => {
		const { status } = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { origin: 'https://evil.com' });
		assert.strictEqual(status, 403);
	});
});
