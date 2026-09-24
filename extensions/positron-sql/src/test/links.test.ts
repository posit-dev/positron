/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { collectLinks } from '../links';
import { SqlSchema } from '../schema';
import { SchemaIndex } from '../schemaIndex';
import { partialPayloadOf, payloadOf, schemaOf, sqlDocument, testAnalyzer } from './support';

const SCHEMA = schemaOf('sales.orders: id, total', 'customers: id, name');

/** The links for a document, as `text under the link -> profile: kind:name/kind:name`. */
async function links(text: string, schema: SchemaIndex = SCHEMA): Promise<string[]> {
	const document = await sqlDocument(text);
	const analysis = testAnalyzer().analyze(text, '');
	return collectLinks(document, analysis, schema).map(link => {
		const [{ profileId, path }] = decode(link.target!);
		const walk = path.map(segment => `${segment.kind}:${segment.name}`).join('/');
		return `${document.getText(link.range)} -> ${profileId}: ${walk}`;
	});
}

/** Reads back the command arguments a link target encodes. */
function decode(target: vscode.Uri): [{ profileId: string; path: { kind: string; name: string }[] }] {
	return JSON.parse(decodeURIComponent(target.query));
}

suite('collectLinks', () => {

	test('a table name links to its row', async () => {
		assert.deepStrictEqual(
			await links('SELECT * FROM orders'),
			['orders -> test-profile: schema:sales/table:orders'],
		);
	});

	test('a column name links to the field under its table', async () => {
		assert.deepStrictEqual(
			await links('SELECT total FROM orders'),
			[
				'total -> test-profile: schema:sales/table:orders/field:total',
				'orders -> test-profile: schema:sales/table:orders',
			],
		);
	});

	test('a path omits the namespace levels the connection did not report', async () => {
		assert.deepStrictEqual(
			await links('SELECT * FROM customers'),
			['customers -> test-profile: table:customers'],
		);
	});

	test('a path uses every level the connection did report', async () => {
		assert.deepStrictEqual(
			await links('SELECT * FROM orders', schemaOf('warehouse.sales.orders: id')),
			['orders -> test-profile: catalog:warehouse/schema:sales/table:orders'],
		);
	});

	test('the link runs the reveal command', async () => {
		const document = await sqlDocument('SELECT * FROM orders');
		const [link] = collectLinks(document, testAnalyzer().analyze(document.getText(), ''), SCHEMA);

		assert.strictEqual(link.target!.scheme, 'command');
		assert.strictEqual(link.target!.path, 'positronDataConnections.revealNode');
	});

	test('unknown names are not linked', async () => {
		assert.deepStrictEqual(await links('SELECT quantity FROM invoices'), []);
	});

	test('a table with no profile is not linked', async () => {
		// The connection did not say which tree the table lives in, so there is no row to reveal.
		const schema: SqlSchema = {
			...payloadOf('orders: id'),
			tables: payloadOf('orders: id').tables.map(table => ({ ...table, profileId: undefined })),
		};

		assert.deepStrictEqual(await links('SELECT * FROM orders', new SchemaIndex(schema)), []);
	});

	test('an empty schema produces no links', async () => {
		assert.deepStrictEqual(await links('SELECT * FROM orders', new SchemaIndex()), []);
	});

	test('a schema read only in part still links what it does have', async () => {
		// Unlike diagnostics, a link says only that this name is that row, which a partial schema
		// can still be right about.
		const partial = new SchemaIndex(partialPayloadOf('orders: id'));

		assert.deepStrictEqual(
			await links('SELECT * FROM orders', partial),
			['orders -> test-profile: table:orders'],
		);
	});

	test('a statement that does not parse does not lose the others their links', async () => {
		assert.deepStrictEqual(
			await links('SELECT * FRM nonsense;\nSELECT * FROM customers'),
			['customers -> test-profile: table:customers'],
		);
	});

	test('a name needing escaping survives the round trip', async () => {
		// A table name can hold any character a URI gives meaning to, so the whole payload is one
		// encoded component. The link covers the quotes as well as the name, so the gesture works
		// from anywhere on it.
		const schema = schemaOf('Order Details & Co: id');

		assert.deepStrictEqual(
			await links('SELECT * FROM "Order Details & Co"', schema),
			['"Order Details & Co" -> test-profile: table:Order Details & Co'],
		);
	});
});
