/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { ConnectClient } from '../connectClient.js';
import { createPinsDriver } from '../pinsDriver.js';
import { PinsConnection } from '../pinsConnection.js';

/** A minimal ExtensionContext exposing only extensionPath, which is all the driver factory reads. */
function fakeContext(): vscode.ExtensionContext {
	// Compiled tests live in out/test/, so the extension root is two levels up (for the icon asset).
	const extensionPath = path.join(__dirname, '..', '..');
	// eslint-disable-next-line local/code-no-any-casts
	return { extensionPath, subscriptions: [] } as any as vscode.ExtensionContext;
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
	const driver = createPinsDriver(fakeContext());

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
	const routes = [
		{ match: '/__api__/applications', body: applications },
		{ match: '/content/g-sales/', body: 'file: sales.csv\ntype: csv\napi_version: 1\n' },
		{ match: '/content/g-cars/', body: 'file: cars.parquet\ntype: parquet\napi_version: 1\n' },
		{ match: '/content/g-model/', body: 'file: model.joblib\ntype: joblib\napi_version: 1\n' },
	];

	function connection(): PinsConnection {
		return new PinsConnection(new ConnectClient('https://c.example.com', 'key', routingFetch(routes)));
	}

	test('groups pins by owner, sorted, rendered as owner nodes', async () => {
		const owners = await connection().getChildren();
		assert.deepStrictEqual(owners.map(o => o.name), ['julia', 'tim']);
		owners.forEach(o => assert.strictEqual(o.kind, positron.DataConnectionNodeKind.Owner));
	});

	test('owner expands to pins sorted by name, badged with type, as leaves', async () => {
		const [julia] = await connection().getChildren();
		const pins = await julia.getChildren!();

		assert.deepStrictEqual(pins.map(p => ({ name: p.name, kind: p.kind, dataType: p.dataType })), [
			{ name: 'cars', kind: positron.DataConnectionNodeKind.Pin, dataType: 'parquet' },
			{ name: 'sales', kind: positron.DataConnectionNodeKind.Pin, dataType: 'csv' },
		]);
		// Pins are leaves in PR 1: no children, not previewable.
		pins.forEach(p => {
			assert.strictEqual(p.getChildren, undefined);
			assert.strictEqual(p.preview, undefined);
		});
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

		const conn = new PinsConnection(new ConnectClient('https://c.example.com', 'key', failFirstFetch));

		// First browse fails...
		await assert.rejects(() => conn.getChildren(), /network blip/);
		// ...and because the enumeration isn't cached, the next browse re-fetches and succeeds.
		const owners = await conn.getChildren();
		assert.deepStrictEqual(owners.map(o => o.name), ['julia', 'tim']);
	});

	test('browsing after disconnect throws', async () => {
		const conn = connection();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
		await assert.rejects(() => conn.getChildren(), /closed/);
	});
});
