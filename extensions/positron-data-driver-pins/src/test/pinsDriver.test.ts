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
import { ConnectClient } from '../connectClient.js';
import { createPinsDriver } from '../pinsDriver.js';
import { PinsCache } from '../pinsCache.js';
import { PinsConnection } from '../pinsConnection.js';

/** A minimal ExtensionContext exposing only extensionPath, which is all the driver factory reads. */
function fakeContext(): vscode.ExtensionContext {
	// Compiled tests live in out/test/, so the extension root is two levels up (for the icon asset).
	const extensionPath = path.join(__dirname, '..', '..');
	// eslint-disable-next-line local/code-no-any-casts
	return { extensionPath, subscriptions: [] } as any as vscode.ExtensionContext;
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
		const [mechanism] = driver.mechanisms;
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
			new ConnectClient('https://c.example.com', 'key', routingFetch(routes)),
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
			new ConnectClient('https://c.example.com', 'key', routingFetch(mixedRoutes)),
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

		const conn = new PinsConnection(new ConnectClient('https://c.example.com', 'key', failFirstFetch), fakeDataExplorerHandler(), fakeCache());

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

		const conn = new PinsConnection(new ConnectClient('https://c.example.com', 'key', failFirstMeta), fakeDataExplorerHandler(), fakeCache());

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
			new ConnectClient('https://c.example.com', 'key', disconnectDuringDownload),
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
