/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SchemaIndex } from '../schemaIndex';
import { partialPayloadOf, schemaOf } from './support';

/** The qualified names of a lookup's results, which is what makes one match distinguishable. */
function names(tables: readonly { name: string; schema?: string; catalog?: string }[]): string[] {
	return tables.map(table => [table.catalog, table.schema, table.name].filter(Boolean).join('.'));
}

suite('SchemaIndex', () => {

	test('lookup is case insensitive', () => {
		// Most engines fold unquoted identifiers, and the case a connection reports is not
		// necessarily the case the user typed.
		const schema = schemaOf('CUSTOMERS: ID, NAME');

		assert.deepStrictEqual(names(schema.tablesNamed('customers')), ['CUSTOMERS']);
		assert.deepStrictEqual(names(schema.resolve('CuStOmErS')), ['CUSTOMERS']);
	});

	test('resolve matches a reference that omits its namespace', () => {
		const schema = schemaOf('sales.orders: id');

		assert.deepStrictEqual(names(schema.resolve('orders')), ['sales.orders']);
	});

	test('resolve rejects a reference that names the wrong namespace', () => {
		const schema = schemaOf('sales.orders: id');

		assert.deepStrictEqual(names(schema.resolve('orders', 'archive')), []);
	});

	test('a two-part name matches either namespace level', () => {
		// `catalog.table` on an engine with no schema level reads the same as `schema.table`.
		const schema = schemaOf('warehouse.orders: id');

		assert.deepStrictEqual(names(schema.resolve('orders', 'warehouse')), ['warehouse.orders']);
	});

	test('a catalog qualifier matches the catalog', () => {
		const schema = schemaOf('warehouse.sales.orders: id');

		assert.deepStrictEqual(
			names(schema.resolve('orders', 'sales', 'warehouse')),
			['warehouse.sales.orders'],
		);
		assert.deepStrictEqual(names(schema.resolve('orders', 'sales', 'elsewhere')), []);
	});

	test('same named tables in two schemas both resolve', () => {
		const schema = schemaOf('sales.orders: id', 'archive.orders: id');

		assert.deepStrictEqual(names(schema.resolve('orders')), ['sales.orders', 'archive.orders']);
	});

	test('namespaces are the catalogs and schemas of known tables', () => {
		const schema = schemaOf('warehouse.sales.orders: id', 'customers: id');

		assert.strictEqual(schema.isNamespace('sales'), true);
		assert.strictEqual(schema.isNamespace('warehouse'), true);
		assert.strictEqual(schema.isNamespace('orders'), false, 'a table is not a namespace');
		assert.strictEqual(schema.isNamespace('customers'), false, 'nor is an unqualified one');
	});

	test('tablesInNamespace finds both schemas and catalogs', () => {
		const schema = schemaOf('warehouse.sales.orders: id', 'warehouse.archive.old: id');

		assert.deepStrictEqual(names(schema.tablesInNamespace('sales')), ['warehouse.sales.orders']);
		assert.deepStrictEqual(
			names(schema.tablesInNamespace('warehouse')),
			['warehouse.sales.orders', 'warehouse.archive.old'],
		);
	});

	test('an empty schema is not complete enough to judge a name by', () => {
		// Nothing is connected, so a name it does not have says nothing about the name.
		const schema = new SchemaIndex();

		assert.strictEqual(schema.isEmpty, true);
		assert.strictEqual(schema.isComplete, false);
	});

	test('a schema read only in part is not complete enough either', () => {
		// A table missing from it was far more likely dropped by a node cap than misspelled.
		const schema = new SchemaIndex(partialPayloadOf('orders: id'));

		assert.strictEqual(schema.isEmpty, false);
		assert.strictEqual(schema.isComplete, false);
	});

	test('a full schema is complete', () => {
		assert.strictEqual(schemaOf('orders: id').isComplete, true);
	});
});
