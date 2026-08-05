/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IDuckDBDataExplorerHost } from 'positron-data-explorer-duckdb';
import { generateKeyPair, KeyAuthenticator } from '../connectAuth.js';
import { ConnectClient } from '../connectClient.js';
import { createPinsDriver } from '../pinsDriver.js';
import { PinsCache } from '../pinsCache.js';
import { PinsConnection } from '../pinsConnection.js';
import { TokenClaimResult } from '../tokenAuth.js';
import { SecretTokenCredentialStore } from '../tokenCredentialStore.js';

/** An in-memory SecretStorage for the fake context. */
function memorySecrets(): vscode.SecretStorage {
	const map = new Map<string, string>();
	const secrets = {
		get: async (k: string) => map.get(k),
		store: async (k: string, v: string) => { map.set(k, v); },
		delete: async (k: string) => { map.delete(k); },
		onDidChange: () => ({ dispose() { } }),
	};
	// eslint-disable-next-line local/code-no-any-casts
	return secrets as any as vscode.SecretStorage;
}

/** A minimal ExtensionContext exposing extensionPath (for the icon) and secret storage. */
function fakeContext(): vscode.ExtensionContext {
	// Compiled tests live in out/test/, so the extension root is two levels up (for the icon asset).
	const extensionPath = path.join(__dirname, '..', '..');
	// eslint-disable-next-line local/code-no-any-casts
	return { extensionPath, subscriptions: [], secrets: memorySecrets() } as any as vscode.ExtensionContext;
}

/** A no-op Data Explorer host: the tree tests browse and inspect nodes, they never open a preview. */
function fakeDataExplorerHandler(): IDuckDBDataExplorerHost {
	return {
		openTableView: async () => { },
		openColumnView: async () => { },
		closeTableView: () => { },
	};
}

/** A cache pointed at the temp dir; the tree tests never download, so nothing is written. */
function fakeCache(): PinsCache {
	return new PinsCache(os.tmpdir());
}

/** A fetch stand-in that routes by URL substring, for driving a real ConnectClient in tests. */
function routingFetch(routes: { match: string; body: string }[]): typeof fetch {
	return (async (input: string | URL): Promise<Response> => {
		const url = typeof input === 'string' ? input : input.toString();
		const route = routes.find(r => url.includes(r.match));
		return new Response(route ? route.body : '', { status: route ? 200 : 404 });
	}) as typeof fetch;
}

suite('Pins Driver', () => {
	const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());

	test('marks the server URL and API key parameters required, with the key a secret', () => {
		const mechanism = driver.mechanisms.find(m => m.id === 'apiKey')!;
		const serverUrl = mechanism.parameters.find(p => p.id === 'serverUrl')!;
		assert.strictEqual(serverUrl.required, true);

		const apiKey = mechanism.parameters.find(p => p.id === 'apiKey')!;
		// Required matters beyond validation: the configure dialog appends "(optional)" to the label of
		// any non-required field, which would break exact-label lookups in e2e tests. Password params
		// are always secret (stored in secret storage by the framework).
		assert.strictEqual(apiKey.required, true);
		assert.strictEqual(apiKey.type, positron.DataConnectionParameterType.Password);
		if (apiKey.type === positron.DataConnectionParameterType.Password) {
			assert.strictEqual(apiKey.secret, true);
		}
	});

	// --- connect() validation ---

	test('connect rejects an unknown mechanism', async () => {
		await assert.rejects(async () => driver.connect('bogus', { serverUrl: 'x', apiKey: 'y' }), /Unknown connection mechanism/);
	});

	test('connect requires a server URL and an API key', async () => {
		await assert.rejects(async () => driver.connect('apiKey', {}), /Server URL is required/);
		await assert.rejects(async () => driver.connect('apiKey', { serverUrl: 'https://c.example.com' }), /API Key is required/);
	});

	// --- generateConnectionCode() ---

	test('R code: env-var default first, explicit server reads the key from the environment', async () => {
		const variants = await driver.generateConnectionCode!('apiKey', 'r', { serverUrl: 'https://c.example.com' });
		assert.deepStrictEqual(variants.map(v => v.id), ['envvar', 'explicitServer']);
		assert.ok(variants[0].code.includes('board_connect()'));
		assert.ok(variants[1].code.includes('server = "https://c.example.com"'));
		assert.ok(variants[1].code.includes('Sys.getenv("CONNECT_API_KEY")'));
	});

	test('R code embeds the key only when secrets are included', async () => {
		const variants = await driver.generateConnectionCode!('apiKey', 'r', { serverUrl: 'https://c.example.com', apiKey: 'the-key' });
		assert.ok(variants[1].code.includes('key = "the-key"'));
	});

	test('Python code: env-var default, explicit server with server_url', async () => {
		const variants = await driver.generateConnectionCode!('apiKey', 'python', { serverUrl: 'https://c.example.com', apiKey: 'the-key' });
		assert.deepStrictEqual(variants.map(v => v.id), ['envvar', 'explicitServer']);
		assert.ok(variants[0].code.includes('pins.board_connect()'));
		assert.ok(variants[1].code.includes('server_url="https://c.example.com"'));
		assert.ok(variants[1].code.includes('api_key="the-key"'));
	});

	test('generateConnectionCode returns nothing for an unsupported language', async () => {
		assert.deepStrictEqual(await driver.generateConnectionCode!('apiKey', 'sql', { serverUrl: 'x' }), []);
	});
});

suite('Pins Driver mechanisms', () => {
	// connectWithClient validates via getServerSettings then getCurrentUser, so both routes are needed.
	const validatingRoutes = [
		{ match: '/__api__/server_settings', body: '{"version":"2024.01.0"}' },
		{ match: '/__api__/v1/user', body: '{"username":"julia"}' },
	];
	// A real RSA private key, so the token authenticator can actually sign the validation requests
	// (the stubbed fetch never verifies the signature, but building it must not throw).
	const realKey = generateKeyPair().privateKey;

	test('exposes token, apiKey, and envvar mechanisms in that order', () => {
		// Order is deliberate, not incidental: mechanisms[0] is the dialog's default selection, so
		// token first is the "browser sign-in leads" choice. It is also safe for existing profiles,
		// which all carry a persisted mechanismId (pins postdates mechanismId persistence) and so
		// never fall back to mechanisms[0]. This assertion guards that intentional order; a reorder
		// should be a conscious decision that updates it.
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());
		assert.deepStrictEqual(driver.mechanisms.map(m => m.id), ['token', 'apiKey', 'envvar']);
	});

	test('the token mechanism takes only a required server URL', () => {
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());
		const token = driver.mechanisms.find(m => m.id === 'token')!;
		assert.deepStrictEqual(token.parameters.map(p => p.id), ['serverUrl']);
		assert.strictEqual(token.parameters[0].required, true);
	});

	test('the envvar mechanism takes no parameters', () => {
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());
		const envvar = driver.mechanisms.find(m => m.id === 'envvar')!;
		assert.deepStrictEqual(envvar.parameters, []);
	});

	test('envvar connect fails clearly when the variables are unset', async () => {
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache(), undefined, { env: {} });
		await assert.rejects(async () => driver.connect('envvar', {}), /CONNECT_SERVER and CONNECT_API_KEY/);
	});

	test('envvar connect uses the environment variables and validates', async () => {
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache(), undefined, {
			env: { CONNECT_SERVER: 'https://c.example.com', CONNECT_API_KEY: 'k' },
			fetch: routingFetch(validatingRoutes),
		});
		const connection = await driver.connect('envvar', {});
		assert.strictEqual(await connection.isConnected(), true);
	});

	test('token connect runs the claim flow and persists the credential on first connect', async () => {
		const context = fakeContext();
		const store = new SecretTokenCredentialStore(context.secrets);
		let claims = 0;
		const claimFake = async (): Promise<TokenClaimResult> => {
			claims++;
			return { credential: { token: 'T-new', privateKey: realKey }, username: 'julia' };
		};
		const driver = createPinsDriver(context, fakeDataExplorerHandler(), fakeCache(), undefined, {
			credentialStore: store, claimToken: claimFake, fetch: routingFetch(validatingRoutes),
		});

		const connection = await driver.connect('token', { serverUrl: 'https://c.example.com' });
		assert.strictEqual(await connection.isConnected(), true);
		assert.strictEqual(claims, 1);
		assert.deepStrictEqual(await store.get('https://c.example.com'), { token: 'T-new', privateKey: realKey });
	});

	test('token connect reuses a stored credential without re-claiming when it validates', async () => {
		const context = fakeContext();
		const store = new SecretTokenCredentialStore(context.secrets);
		await store.set('https://c.example.com', { token: 'T-stored', privateKey: realKey });
		let claims = 0;
		const claimFake = async (): Promise<TokenClaimResult> => { claims++; return { credential: { token: 'x', privateKey: realKey }, username: 'u' }; };
		const driver = createPinsDriver(context, fakeDataExplorerHandler(), fakeCache(), undefined, {
			credentialStore: store, claimToken: claimFake, fetch: routingFetch(validatingRoutes),
		});

		const connection = await driver.connect('token', { serverUrl: 'https://c.example.com' });
		assert.strictEqual(await connection.isConnected(), true);
		assert.strictEqual(claims, 0);
	});

	test('token connect re-claims when the stored credential is rejected', async () => {
		const context = fakeContext();
		const store = new SecretTokenCredentialStore(context.secrets);
		await store.set('https://c.example.com', { token: 'T-stale', privateKey: realKey });
		let claims = 0;
		const claimFake = async (): Promise<TokenClaimResult> => { claims++; return { credential: { token: 'T-fresh', privateKey: realKey }, username: 'julia' }; };
		// The first /v1/user call (validating the stored credential) is rejected, forcing a re-claim; the
		// next call (connectWithClient after re-claim) succeeds. server_settings always succeeds.
		let userCalls = 0;
		const rejectThenAccept = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/__api__/server_settings')) {
				return new Response('{"version":"2024.01.0"}', { status: 200 });
			}
			if (url.includes('/__api__/v1/user')) {
				userCalls++;
				return userCalls === 1
					? new Response('no', { status: 401 })
					: new Response('{"username":"julia"}', { status: 200 });
			}
			return new Response('', { status: 404 });
		}) as typeof fetch;
		const driver = createPinsDriver(context, fakeDataExplorerHandler(), fakeCache(), undefined, {
			credentialStore: store, claimToken: claimFake, fetch: rejectThenAccept,
		});

		const connection = await driver.connect('token', { serverUrl: 'https://c.example.com' });
		assert.strictEqual(await connection.isConnected(), true);
		assert.strictEqual(claims, 1);
		assert.deepStrictEqual(await store.get('https://c.example.com'), { token: 'T-fresh', privateKey: realKey });
	});

	test('token connect surfaces a transient failure instead of discarding the stored credential', async () => {
		const context = fakeContext();
		const store = new SecretTokenCredentialStore(context.secrets);
		const storedCredential = { token: 'T-good', privateKey: realKey };
		await store.set('https://c.example.com', storedCredential);
		let claims = 0;
		const claimFake = async (): Promise<TokenClaimResult> => { claims++; return { credential: { token: 'T-new', privateKey: realKey }, username: 'julia' }; };
		// The server is briefly unavailable. A 503 says nothing about the credential, so it must not be
		// treated as a revoked sign-in: re-claiming would throw away a working credential and open a
		// browser window for a server-side blip.
		const unavailable = (async (): Promise<Response> => new Response('bad gateway', { status: 503 })) as typeof fetch;
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache(), undefined, {
			credentialStore: store, claimToken: claimFake, fetch: unavailable,
		});

		await assert.rejects(async () => driver.connect('token', { serverUrl: 'https://c.example.com' }), /HTTP 503/);
		assert.strictEqual(claims, 0);
		assert.deepStrictEqual(await store.get('https://c.example.com'), storedCredential);
	});

	test('token code-gen emits the bare default board open for R and Python', async () => {
		// The bare `board_connect()` / `pins.board_connect()` is the intended output (user decision
		// 2026-07-23), not a gap: pins resolves credentials through its own channels (R's rsconnect
		// account registry, Python's CONNECT_* env vars), never the IDE's secret storage. This asserts
		// that intended user-visible behavior; do not "fix" it by embedding the browser-sign-in token.
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());
		const r = await driver.generateConnectionCode!('token', 'r', { serverUrl: 'https://c.example.com' });
		// The variant is the package default, not the env-var path, so it must not be labelled as the
		// env-var variant is (the two mechanisms emit the same snippet for different reasons).
		assert.deepStrictEqual(r.map(v => v.id), ['default']);
		assert.ok(r[0].code.includes('board_connect()'));
		assert.ok(!r[0].code.includes('CONNECT_API_KEY'));

		const py = await driver.generateConnectionCode!('token', 'python', { serverUrl: 'https://c.example.com' });
		assert.deepStrictEqual(py.map(v => v.id), ['default']);
		assert.ok(py[0].code.includes('pins.board_connect()'));
		assert.ok(!py[0].code.includes('CONNECT_API_KEY'));
	});

	test('envvar code-gen emits only the environment-variable board open', async () => {
		const driver = createPinsDriver(fakeContext(), fakeDataExplorerHandler(), fakeCache());
		const r = await driver.generateConnectionCode!('envvar', 'r', {});
		assert.deepStrictEqual(r.map(v => v.id), ['envvar']);
		assert.ok(r[0].code.includes('board_connect()'));
	});
});

suite('Pins Connection tree', () => {
	// Two owners, three pins; each pin's data.txt reports a distinct type.
	const applications = JSON.stringify({
		applications: [
			{ guid: 'g-sales', name: 'sales', owner_username: 'julia', bundle_id: 3 },
			{ guid: 'g-cars', name: 'cars', owner_username: 'julia', bundle_id: 1 },
			{ guid: 'g-model', name: 'model', owner_username: 'tim', bundle_id: 9 },
		],
	});
	// cars has two versions, returned out of order to confirm they are surfaced newest first.
	const carsBundles = JSON.stringify([
		{ id: 1, created_time: '2024-01-15T09:30:00Z', active: false, size: 100 },
		{ id: 5, created_time: '2024-03-02T14:00:00Z', active: true, size: 200 },
	]);
	const routes = [
		{ match: '/__api__/applications', body: applications },
		// Bundles routes precede the data.txt routes: a bundles URL also contains the "/content/<guid>/"
		// substring the data.txt routes match on, so the more specific bundles match must be found first.
		{ match: '/v1/content/g-cars/bundles', body: carsBundles },
		{ match: '/content/g-sales/', body: 'file: sales.csv\ntype: csv\napi_version: 1\n' },
		{ match: '/content/g-cars/', body: 'file: cars.parquet\ntype: parquet\napi_version: 1\n' },
		{ match: '/content/g-model/', body: 'file: model.joblib\ntype: joblib\napi_version: 1\n' },
	];

	function connection(): PinsConnection {
		return new PinsConnection(
			new ConnectClient('https://c.example.com', new KeyAuthenticator('key'), routingFetch(routes)),
			fakeDataExplorerHandler(),
			fakeCache(),
		);
	}

	test('groups pins by owner, sorted, rendered as owner nodes', async () => {
		const owners = await connection().getChildren();
		assert.deepStrictEqual(owners.map(o => o.name), ['julia', 'tim']);
		owners.forEach(o => assert.strictEqual(o.kind, positron.DataConnectionNodeKind.Owner));
	});

	test('owner expands to pins sorted by name, badged with type; tabular pins are previewable', async () => {
		const [julia] = await connection().getChildren();
		const pins = await julia.getChildren!();

		assert.deepStrictEqual(pins.map(p => ({ name: p.name, kind: p.kind, dataType: p.dataType })), [
			{ name: 'cars', kind: positron.DataConnectionNodeKind.Pin, dataType: 'parquet' },
			{ name: 'sales', kind: positron.DataConnectionNodeKind.Pin, dataType: 'csv' },
		]);
		// Pins expand to versions, and tabular pins (parquet, csv) can be opened in the Data Explorer.
		pins.forEach(p => {
			assert.notStrictEqual(p.getChildren, undefined);
			assert.notStrictEqual(p.preview, undefined);
		});
	});

	test('a non-tabular pin is not previewable', async () => {
		const [, tim] = await connection().getChildren();
		const [model] = await tim.getChildren!();
		// model is a joblib pin: DuckDB cannot read it, so it stays non-previewable.
		assert.strictEqual(model.dataType, 'joblib');
		assert.strictEqual(model.preview, undefined);
	});

	test('a tabular pin expands to versions, newest first, active badged, previewable leaves', async () => {
		const [julia] = await connection().getChildren();
		const cars = (await julia.getChildren!()).find(p => p.name === 'cars')!;
		const versions = await cars.getChildren!();

		assert.deepStrictEqual(versions.map(v => ({ name: v.name, kind: v.kind, dataType: v.dataType })), [
			{ name: '2024-03-02 14:00 (#5)', kind: positron.DataConnectionNodeKind.Version, dataType: 'active' },
			{ name: '2024-01-15 09:30 (#1)', kind: positron.DataConnectionNodeKind.Version, dataType: undefined },
		]);
		// Versions are leaves (no children); each version of a tabular pin is previewable.
		versions.forEach(v => {
			assert.strictEqual(v.getChildren, undefined);
			assert.notStrictEqual(v.preview, undefined);
		});
	});

	test('version preview is gated on each version\'s own type, not the active version\'s', async () => {
		// A pin whose active version (#5) is parquet but whose older version (#1) is rds. Each version
		// node must reflect its own format, so only the parquet version is previewable.
		const mixedApps = JSON.stringify({ applications: [{ guid: 'g-mixed', name: 'mixed', owner_username: 'julia', bundle_id: 5 }] });
		const mixedBundles = JSON.stringify([
			{ id: 1, created_time: '2024-01-01T00:00:00Z', active: false },
			{ id: 5, created_time: '2024-02-01T00:00:00Z', active: true },
		]);
		// Per-version data.txt routes (more specific than a whole-pin route; matched by _rev segment).
		const mixedRoutes = [
			{ match: '/__api__/applications', body: mixedApps },
			{ match: '/v1/content/g-mixed/bundles', body: mixedBundles },
			{ match: '/content/g-mixed/_rev1/', body: 'file: old.rds\ntype: rds\napi_version: 1\n' },
			{ match: '/content/g-mixed/_rev5/', body: 'file: new.parquet\ntype: parquet\napi_version: 1\n' },
		];
		const conn = new PinsConnection(
			new ConnectClient('https://c.example.com', new KeyAuthenticator('key'), routingFetch(mixedRoutes)),
			fakeDataExplorerHandler(),
			fakeCache(),
		);

		const [julia] = await conn.getChildren();
		const [mixed] = await julia.getChildren!();
		// The pin badge + the pin node's preview follow the active (parquet) version.
		assert.strictEqual(mixed.dataType, 'parquet');
		assert.notStrictEqual(mixed.preview, undefined);

		// Versions are newest-first: [#5 parquet (active), #1 rds]. Only the parquet one is previewable.
		const [v5, v1] = await mixed.getChildren!();
		assert.notStrictEqual(v5.preview, undefined);
		assert.strictEqual(v1.preview, undefined);
	});

	test('a failed enumeration does not stick; the next browse re-fetches', async () => {
		let applicationsAttempts = 0;
		const failFirstFetch = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/__api__/applications')) {
				applicationsAttempts++;
				// Fail the first enumeration (as a timeout/network blip would), then succeed.
				if (applicationsAttempts === 1) {
					throw new Error('network blip');
				}
				return new Response(applications, { status: 200 });
			}
			return new Response('', { status: 404 });
		}) as typeof fetch;

		const conn = new PinsConnection(new ConnectClient('https://c.example.com', new KeyAuthenticator('key'), failFirstFetch), fakeDataExplorerHandler(), fakeCache());

		// First browse fails...
		await assert.rejects(() => conn.getChildren(), /network blip/);
		// ...and because the enumeration isn't cached, the next browse re-fetches and succeeds.
		const owners = await conn.getChildren();
		assert.deepStrictEqual(owners.map(o => o.name), ['julia', 'tim']);
	});

	test('a failed type lookup does not stick; re-expanding the owner re-fetches the badge', async () => {
		let carsMetaAttempts = 0;
		const failFirstMeta = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/content/g-cars/')) {
				carsMetaAttempts++;
				// Fail the first metadata read for this pin (as a blip would), then succeed.
				if (carsMetaAttempts === 1) {
					return new Response('boom', { status: 500 });
				}
			}
			const route = routes.find(r => url.includes(r.match));
			return new Response(route ? route.body : '', { status: route ? 200 : 404 });
		}) as typeof fetch;

		const conn = new PinsConnection(new ConnectClient('https://c.example.com', new KeyAuthenticator('key'), failFirstMeta), fakeDataExplorerHandler(), fakeCache());

		// First expansion: the cars badge is missing because its metadata read failed.
		const [julia1] = await conn.getChildren();
		const cars1 = (await julia1.getChildren!()).find(p => p.name === 'cars')!;
		assert.strictEqual(cars1.dataType, undefined);

		// Re-expanding re-fetches (the failure wasn't cached), so the badge now resolves.
		const [julia2] = await conn.getChildren();
		const cars2 = (await julia2.getChildren!()).find(p => p.name === 'cars')!;
		assert.strictEqual(cars2.dataType, 'parquet');
	});

	test('browsing after disconnect throws', async () => {
		const conn = connection();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
		await assert.rejects(() => conn.getChildren(), /closed/);
	});

	test('previewPin aborts without registering a view if disconnected during the download', async () => {
		// Fake handler that records whether a view was ever registered.
		let openTableViewCalls = 0;
		const handler: IDuckDBDataExplorerHost = {
			openTableView: async () => { openTableViewCalls++; },
			openColumnView: async () => { },
			closeTableView: () => { },
		};
		// A fresh cache dir guarantees a cache miss (so the download actually runs).
		const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'pins-preview-'));
		// Holder so the fetch stub can close over the connection it will disconnect (the connection is
		// built with that stub, hence the forward reference).
		const ref: { conn?: PinsConnection } = {};
		const disconnectDuringDownload = (async (input: string | URL): Promise<Response> => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.endsWith('/data.txt')) {
				return new Response('file: data.parquet\ntype: parquet\napi_version: 1\n', { status: 200 });
			}
			if (url.includes('/data.parquet')) {
				// The user collapses the connection mid-download.
				await ref.conn!.disconnect();
				return new Response('PARQUET-BYTES', { status: 200 });
			}
			return new Response('', { status: 404 });
		}) as typeof fetch;

		ref.conn = new PinsConnection(
			new ConnectClient('https://c.example.com', new KeyAuthenticator('key'), disconnectDuringDownload),
			handler,
			new PinsCache(cacheDir),
		);
		try {
			const pin = { guid: 'g', name: 'p', ownerUsername: 'julia', title: '', description: '', activeBundleId: '1' };
			await ref.conn.previewPin(pin, '1', true);
			// Disconnected before the view was built, so nothing should have been registered (it would
			// leak, since disconnect's cleanup has already run).
			assert.strictEqual(openTableViewCalls, 0);
		} finally {
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});
