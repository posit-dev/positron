/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { generateKeyPair, KeyAuthenticator, RequestAuthenticator, TokenAuthenticator } from '../connectAuth.js';
import { ConnectClient, normalizeServerUrl } from '../connectClient.js';

/** A RequestAuthenticator that records the paths it is asked to sign, standing in for a real one. */
class RecordingAuthenticator implements RequestAuthenticator {
	readonly authFailureHint = 'test hint.';
	readonly signedPaths: string[] = [];
	headers(_method: string, path: string, _bodyChecksum: string): Record<string, string> {
		this.signedPaths.push(path);
		return {};
	}
}

/** The named request header of the first recorded request. */
function headerOf(init: RequestInit | undefined, name: string): string | undefined {
	return (init?.headers as Record<string, string> | undefined)?.[name];
}

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

	test('defaults a missing scheme to https and preserves an explicit one', () => {
		assert.strictEqual(normalizeServerUrl('pub.demo.posit.team'), 'https://pub.demo.posit.team');
		assert.strictEqual(normalizeServerUrl('connect.example.com/'), 'https://connect.example.com');
		assert.strictEqual(normalizeServerUrl('http://localhost:3939'), 'http://localhost:3939');
	});
});

suite('ConnectClient', () => {
	const SERVER = 'https://connect.example.com';
	const KEY = 'secret-key';

	test('sends the Authorization: Key header on every request', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"version":"2024.01.0"}' }));
		const client = new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch);
		await client.getServerSettings();
		assert.strictEqual(authHeaderOf(calls[0].init), `Key ${KEY}`);
	});

	test('sends the rsconnect token signing headers when using a TokenAuthenticator', async () => {
		// Above the crypto unit level: prove a real TokenAuthenticator wired through the client puts the
		// signed headers on the actual request, not just that a mocked response succeeds.
		const { fetch, calls } = recordingFetch(() => ({ body: '{"username":"julia"}' }));
		const credential = { token: 'T-abc123', privateKey: generateKeyPair().privateKey };
		await new ConnectClient(SERVER, new TokenAuthenticator(credential), fetch).getCurrentUser();
		assert.deepStrictEqual(
			{
				token: headerOf(calls[0].init, 'X-Auth-Token'),
				hasSignature: (headerOf(calls[0].init, 'X-Auth-Signature') ?? '').length > 0,
				hasDate: (headerOf(calls[0].init, 'Date') ?? '').length > 0,
				hasChecksum: (headerOf(calls[0].init, 'X-Content-Checksum') ?? '').length > 0,
				noApiKeyHeader: headerOf(calls[0].init, 'Authorization') === undefined,
			},
			{ token: 'T-abc123', hasSignature: true, hasDate: true, hasChecksum: true, noApiKeyHeader: true },
		);
	});

	test('getServerSettings reads the version', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"version":"2024.01.0"}' }));
		const settings = await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getServerSettings();
		assert.strictEqual(settings.version, '2024.01.0');
		assert.strictEqual(calls[0].url, `${SERVER}/__api__/server_settings`);
	});

	test('getCurrentUser reads the username', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: '{"username":"julia"}' }));
		const user = await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getCurrentUser();
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
		const pins = await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).listPins();
		assert.deepStrictEqual(pins, [
			{ guid: 'g1', name: 'mtcars', ownerUsername: 'julia', title: 'Cars', description: 'd', activeBundleId: '42' },
			{ guid: 'g2', name: 'sales', ownerUsername: 'tim', title: '', description: '', activeBundleId: '7' },
		]);
		// Filters server-side to pin content, with the colon left unencoded.
		assert.ok(calls[0].url.includes('filter=content_type:pin'), calls[0].url);
	});

	test('signs the pathname without the query string (Connect token signature excludes it)', async () => {
		// The request URL carries a query string, but Connect's token signature covers only the
		// pathname; signing pathname + query makes token-authenticated listPins 401 while every other
		// (query-less) request succeeds. The URL sent to fetch still carries the full query.
		const { fetch, calls } = recordingFetch(() => ({ body: JSON.stringify({ applications: [] }) }));
		const auth = new RecordingAuthenticator();
		await new ConnectClient(SERVER, auth, fetch).listPins();
		assert.deepStrictEqual(auth.signedPaths, ['/__api__/applications']);
		assert.ok(calls[0].url.includes('?filter=content_type:pin'), calls[0].url);
	});

	test('listBundles parses the bundles response into BundleInfo, newest first', async () => {
		const { fetch, calls } = recordingFetch(() => ({
			// Returned out of order to confirm the client sorts newest first.
			body: JSON.stringify([
				{ id: 1, created_time: '2024-01-15T09:30:00Z', active: false, size: 100 },
				{ id: 5, created_time: '2024-03-02T14:00:00Z', active: true, size: 200 },
			]),
		}));
		const bundles = await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).listBundles('g1');
		assert.deepStrictEqual(bundles, [
			{ id: '5', createdTime: '2024-03-02T14:00:00Z', active: true, size: 200 },
			{ id: '1', createdTime: '2024-01-15T09:30:00Z', active: false, size: 100 },
		]);
		assert.strictEqual(calls[0].url, `${SERVER}/__api__/v1/content/g1/bundles`);
	});

	test('getPinMeta fetches data.txt from the content _rev path and parses it', async () => {
		const { fetch, calls } = recordingFetch(() => ({
			body: 'file: data.parquet\ntype: parquet\ntitle: Cars\napi_version: 1\n',
		}));
		const meta = await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getPinMeta('g1', '42');
		assert.strictEqual(meta.type, 'parquet');
		assert.strictEqual(meta.file, 'data.parquet');
		assert.strictEqual(calls[0].url, `${SERVER}/content/g1/_rev42/data.txt`);
	});

	test('maps 401/403 to an error naming the API key for key auth', async () => {
		const { fetch } = recordingFetch(() => ({ status: 403, body: 'Forbidden' }));
		await assert.rejects(() => new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getCurrentUser(), /Check your API key/);
	});

	test('maps 401/403 to a browser sign-in remediation for token auth, not the API key', async () => {
		// A browser-sign-in connection has no API key, so the old hard-coded "Check your API key"
		// guidance was wrong for it; the message must point the user at re-running the sign-in instead.
		const { fetch } = recordingFetch(() => ({ status: 401, body: 'Unauthorized' }));
		const credential = { token: 'T-abc', privateKey: generateKeyPair().privateKey };
		await assert.rejects(
			() => new ConnectClient(SERVER, new TokenAuthenticator(credential), fetch).getCurrentUser(),
			(err: Error) => /browser sign-in may have expired\. Sign in again\./.test(err.message) && !/API key/.test(err.message),
		);
	});

	test('maps 404 to a not-found error', async () => {
		const { fetch } = recordingFetch(() => ({ status: 404, body: 'nope' }));
		await assert.rejects(() => new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getPinMeta('g', '1'), /Not Found/);
	});

	test('maps other non-2xx to a failure with the body summary', async () => {
		const { fetch } = recordingFetch(() => ({ status: 500, body: 'boom' }));
		await assert.rejects(() => new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).getServerSettings(), /HTTP 500.*boom/);
	});
});

suite('ConnectClient.downloadPinFile', () => {
	const SERVER = 'https://connect.example.com';
	const KEY = 'secret-key';
	let dir: string;

	setup(() => { dir = mkdtempSync(join(tmpdir(), 'pins-download-')); });
	teardown(() => { rmSync(dir, { recursive: true, force: true }); });

	test('streams the data file from the content _rev path to destPath', async () => {
		const { fetch, calls } = recordingFetch(() => ({ body: 'PARQUET-BYTES' }));
		const destPath = join(dir, 'nested', 'data.parquet');
		await new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).downloadPinFile('g1', '42', 'data.parquet', destPath);

		// Fetched from the content-served _rev path (not /__api__/), with the auth header, and written
		// to destPath (parent directory created as needed).
		assert.strictEqual(calls[0].url, `${SERVER}/content/g1/_rev42/data.parquet`);
		assert.strictEqual(authHeaderOf(calls[0].init), `Key ${KEY}`);
		assert.strictEqual(readFileSync(destPath, 'utf-8'), 'PARQUET-BYTES');
	});

	test('leaves no file behind when the request fails', async () => {
		const { fetch } = recordingFetch(() => ({ status: 404, body: 'nope' }));
		const destPath = join(dir, 'data.parquet');
		await assert.rejects(() => new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch).downloadPinFile('g1', '42', 'data.parquet', destPath), /Not Found/);
		assert.strictEqual(existsSync(destPath), false);
		assert.strictEqual(readdirSync(dir).filter(f => f.includes('.download')).length, 0);
	});

	test('concurrent downloads of the same file populate the cache without corruption', async () => {
		// A body large enough that two writes interleaved into one shared temp would not match it.
		const body = 'X'.repeat(200_000);
		const { fetch } = recordingFetch(() => ({ body }));
		const client = new ConnectClient(SERVER, new KeyAuthenticator(KEY), fetch);
		const destPath = join(dir, 'nested', 'data.parquet');

		// Two previews of the same uncached version race to download it (each writes its own unique
		// temp and atomically publishes a complete file).
		await Promise.all([
			client.downloadPinFile('g1', '5', 'data.parquet', destPath),
			client.downloadPinFile('g1', '5', 'data.parquet', destPath),
		]);

		assert.strictEqual(readFileSync(destPath, 'utf-8'), body);
		// No temporary files are left behind by either download.
		assert.strictEqual(readdirSync(dirname(destPath)).filter(f => f.includes('.download')).length, 0);
	});

	test('never logs the API key, even when a request fails', async () => {
		const apiKey = 'SUPERSECRETAPIKEY0123456789';
		const messages: string[] = [];
		const recordingLogger = {
			trace: (m: string) => messages.push(m),
			debug: (m: string) => messages.push(m),
			info: (m: string) => messages.push(m),
			warn: (m: string) => messages.push(m),
			error: (m: string) => messages.push(m),
		};
		const failingFetch = async () => new Response('nope', { status: 401, statusText: 'Unauthorized' });

		const client = new ConnectClient('https://connect.example.com', new KeyAuthenticator(apiKey), failingFetch as typeof fetch, recordingLogger);
		await assert.rejects(() => client.listPins());

		assert.ok(messages.length > 0, 'expected the failure to be logged');
		assert.ok(!messages.some(m => m.includes(apiKey)), `API key leaked into: ${messages.join(' | ')}`);
	});
});
