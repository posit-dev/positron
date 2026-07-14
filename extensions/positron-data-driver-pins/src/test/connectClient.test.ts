/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ConnectClient, normalizeServerUrl } from '../connectClient.js';

/** Records the requests made and returns responses from a route handler, standing in for fetch. */
function recordingFetch(handler: (url: string) => { status?: number; body: string }): {
	fetch: typeof fetch;
	calls: { url: string; init?: RequestInit }[];
} {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchFn = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input.toString();
		calls.push({ url, init });
		const { status = 200, body } = handler(url);
		return new Response(body, { status });
	}) as typeof fetch;
	return { fetch: fetchFn, calls };
}

/** The auth header of the first recorded request. */
function authHeaderOf(init: RequestInit | undefined): string | undefined {
	return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

suite('normalizeServerUrl', () => {
	test('strips trailing __api__ and slashes', () => {
		assert.strictEqual(normalizeServerUrl('https://connect.example.com/'), 'https://connect.example.com');
		assert.strictEqual(normalizeServerUrl('https://connect.example.com/__api__/'), 'https://connect.example.com');
		assert.strictEqual(normalizeServerUrl('https://connect.example.com/__api__'), 'https://connect.example.com');
		assert.strictEqual(normalizeServerUrl('  https://connect.example.com  '), 'https://connect.example.com');
	});

	test('leaves a path prefix intact', () => {
		assert.strictEqual(normalizeServerUrl('https://example.com/connect/__api__/'), 'https://example.com/connect');
	});
});

suite('ConnectClient', () => {
	const SERVER = 'https://connect.example.com';
	const KEY = 'secret-key';

	test('sends the Authorization: Key header on every request', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"version":"2024.01.0"}' }));
		const client = new ConnectClient(SERVER, KEY, fetch);
		await client.getServerSettings();
		assert.strictEqual(authHeaderOf(calls[0].init), `Key ${KEY}`);
	});

	test('getServerSettings reads the version', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"version":"2024.01.0"}' }));
		const settings = await new ConnectClient(SERVER, KEY, fetch).getServerSettings();
		assert.strictEqual(settings.version, '2024.01.0');
		assert.strictEqual(calls[0].url, `${SERVER}/__api__/server_settings`);
	});

	test('getCurrentUser reads the username', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"username":"julia"}' }));
		const user = await new ConnectClient(SERVER, KEY, fetch).getCurrentUser();
		assert.strictEqual(user.username, 'julia');
		assert.strictEqual(calls[0].url, `${SERVER}/__api__/v1/user`);
	});

	test('listPins parses the applications response into PinInfo', async () => {
		const { fetch, calls } = recordingFetch(() => ({
			body: JSON.stringify({
				applications: [
					{ guid: 'g1', name: 'mtcars', owner_username: 'julia', title: 'Cars', description: 'd', bundle_id: 42 },
					{ guid: 'g2', name: 'sales', owner_username: 'tim', bundle_id: '7' },
				],
			}),
		}));
		const pins = await new ConnectClient(SERVER, KEY, fetch).listPins();
		assert.deepStrictEqual(pins, [
			{ guid: 'g1', name: 'mtcars', ownerUsername: 'julia', title: 'Cars', description: 'd', activeBundleId: '42' },
			{ guid: 'g2', name: 'sales', ownerUsername: 'tim', title: '', description: '', activeBundleId: '7' },
		]);
		// Filters server-side to pin content, with the colon left unencoded.
		assert.ok(calls[0].url.includes('filter=content_type:pin'), calls[0].url);
	});

	test('listPins passes a search term', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"applications":[]}' }));
		await new ConnectClient(SERVER, KEY, fetch).listPins('my pin');
		assert.ok(calls[0].url.includes('search=my%20pin'), calls[0].url);
	});

	test('getPinMeta fetches data.txt from the content _rev path and parses it', async () => {
		const { fetch, calls } = recordingFetch(() => ({
			body: 'file: data.parquet\ntype: parquet\ntitle: Cars\napi_version: 1\n',
		}));
		const meta = await new ConnectClient(SERVER, KEY, fetch).getPinMeta('g1', '42');
		assert.strictEqual(meta.type, 'parquet');
		assert.strictEqual(meta.file, 'data.parquet');
		assert.strictEqual(calls[0].url, `${SERVER}/content/g1/_rev42/data.txt`);
	});

	test('maps 401/403 to an API key error', async () => {
		const { fetch } = recordingFetch(() => ({ status: 403, body: 'Forbidden' }));
		await assert.rejects(() => new ConnectClient(SERVER, KEY, fetch).getCurrentUser(), /API key/);
	});

	test('maps 404 to a not-found error', async () => {
		const { fetch } = recordingFetch(() => ({ status: 404, body: 'nope' }));
		await assert.rejects(() => new ConnectClient(SERVER, KEY, fetch).getPinMeta('g', '1'), /Not Found/);
	});

	test('maps other non-2xx to a failure with the body summary', async () => {
		const { fetch } = recordingFetch(() => ({ status: 500, body: 'boom' }));
		await assert.rejects(() => new ConnectClient(SERVER, KEY, fetch).getServerSettings(), /HTTP 500.*boom/);
	});
});
