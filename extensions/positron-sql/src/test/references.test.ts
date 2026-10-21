/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Reference, resolveReferences } from '../references';
import { SchemaIndex } from '../schemaIndex';
import { payloadOf, schemaOf, testAnalyzer } from './support';

/**
 * The references a document produces against a schema, as `kind name: status`.
 *
 * Compared as strings so that a test reads as the judgement it is about. What matters about
 * resolution is not only which names were found but which ones were deliberately not judged, and
 * a name that is absent from this list is one the resolver declined to have an opinion on.
 */
function judge(text: string, schema: SchemaIndex): string[] {
	const analysis = testAnalyzer().analyze(text, '');
	return resolveReferences(analysis, schema).map(describe);
}

function describe(reference: Reference): string {
	return `${reference.kind} ${reference.name}: ${reference.status}`;
}

const SCHEMA = schemaOf('sales.orders: id, total, customer_id', 'customers: id, name');

suite('resolveReferences', () => {

	test('a known table resolves', () => {
		assert.deepStrictEqual(judge('SELECT * FROM customers', SCHEMA), ['table customers: resolved']);
	});

	test('a table found under a schema resolves without naming it', () => {
		assert.deepStrictEqual(judge('SELECT * FROM orders', SCHEMA), ['table orders: resolved']);
	});

	test('an unknown table is reported', () => {
		assert.deepStrictEqual(judge('SELECT * FROM invoices', SCHEMA), ['table invoices: unknown']);
	});

	test('a table in a schema the connection has, but not in that schema, is unknown', () => {
		const schema = schemaOf('sales.orders: id', 'archive.invoices: id');

		assert.deepStrictEqual(judge('SELECT * FROM archive.orders', schema), ['table orders: unknown']);
	});

	test('a table under a namespace the connection does not list is not judged', () => {
		// An attached database, the engine's own catalog, a level the driver does not report: the
		// schema cannot speak for any of them.
		assert.deepStrictEqual(judge('SELECT * FROM other_db.orders', SCHEMA), []);
		assert.deepStrictEqual(judge('SELECT table_name FROM information_schema.tables', SCHEMA), []);
	});

	test('a namespace the connection does not report still finds the table by name', () => {
		// SQLite reports its tables at the root, and `main.` is how a statement names its database.
		const flat = schemaOf('customers: id, name');

		assert.deepStrictEqual(judge('SELECT name FROM main.customers', flat), ['column name: resolved', 'table customers: resolved']);
		// And a known schema under an unreported database: `mydb.sales.orders` in PostgreSQL.
		assert.deepStrictEqual(judge('SELECT total FROM mydb.sales.orders', SCHEMA), ['column total: resolved', 'table orders: resolved']);
	});

	test('the engine\'s own catalog tables are not judged', () => {
		assert.deepStrictEqual(judge('SELECT relname FROM pg_class', SCHEMA), []);
		assert.deepStrictEqual(judge('SELECT name FROM sqlite_master', SCHEMA), []);
	});

	test('a column every row has without declaring it is not unknown', () => {
		assert.deepStrictEqual(
			judge('SELECT rowid, ctid, total FROM orders', SCHEMA),
			['column total: resolved', 'table orders: resolved'],
		);
	});

	test('a correlated subquery resolves a column of the query around it', () => {
		assert.deepStrictEqual(
			judge('SELECT id FROM orders WHERE EXISTS (SELECT 1 FROM customers WHERE name = total)', SCHEMA),
			[
				'column id: resolved',
				'table orders: resolved',
				'table customers: resolved',
				'column name: resolved',
				'column total: resolved',
			],
		);
		assert.deepStrictEqual(
			judge('SELECT id FROM orders WHERE EXISTS (SELECT 1 FROM customers WHERE nonsense = 1)', SCHEMA)
				.filter(each => each.includes('nonsense')),
			['column nonsense: unknown'],
		);
	});

	test('a correlated column qualified by the outer alias resolves', () => {
		assert.deepStrictEqual(
			judge('SELECT 1 FROM orders o WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id)', SCHEMA)
				.filter(each => each.startsWith('column')),
			['column id: resolved', 'column customer_id: resolved'],
		);
	});

	test('a table this file creates is not unknown when it is read later', () => {
		assert.deepStrictEqual(
			judge('CREATE TEMP TABLE recent AS SELECT id FROM orders;\nSELECT id, extra FROM recent;', SCHEMA),
			['column id: resolved', 'table orders: resolved'],
		);
		assert.deepStrictEqual(judge('CREATE VIEW v AS SELECT 1 AS a;\nSELECT a FROM v;', SCHEMA), []);
	});

	test('a table dropped if it exists is not judged', () => {
		assert.deepStrictEqual(judge('DROP TABLE IF EXISTS staging', SCHEMA), []);
		assert.deepStrictEqual(judge('DROP TABLE staging', SCHEMA), ['table staging: unknown']);
	});

	test('the columns of a table this file alters are not judged against the schema', () => {
		const references = judge('ALTER TABLE orders ADD COLUMN shipped date;\nSELECT shipped, total FROM orders;', SCHEMA);

		assert.deepStrictEqual(references.filter(each => each.startsWith('column')), ['column total: resolved']);
	});

	test('a renamed table is known by its new name', () => {
		assert.deepStrictEqual(
			judge('ALTER TABLE customers RENAME TO clients;\nSELECT name FROM clients;', SCHEMA)
				.filter(each => each.includes('clients')),
			[],
		);
	});

	test('a lambda parameter is not a column', () => {
		const analysis = testAnalyzer().analyze('SELECT list_transform([1, 2], x -> x + total) FROM orders', 'duckdb');

		assert.deepStrictEqual(
			resolveReferences(analysis, SCHEMA).map(describe),
			['column total: resolved', 'table orders: resolved'],
		);
	});

	test('an unqualified name several schemas have reads the default schema', () => {
		const schema = new SchemaIndex(payloadOf('main.orders: id, total', 'sales.orders: id, region'), 'main');

		assert.deepStrictEqual(
			judge('SELECT region FROM orders', schema),
			['column region: unknown', 'table orders: resolved'],
		);
	});

	test('a misspelled column in an INSERT column list is unknown', () => {
		assert.deepStrictEqual(
			judge('INSERT INTO orders (id, totl) VALUES (1, 2)', SCHEMA),
			['table orders: resolved', 'column id: resolved', 'column totl: unknown'],
		);
	});

	test('a known column resolves against the table in scope', () => {
		assert.deepStrictEqual(
			judge('SELECT total FROM orders', SCHEMA),
			['column total: resolved', 'table orders: resolved'],
		);
	});

	test('an unknown column is reported', () => {
		assert.deepStrictEqual(
			judge('SELECT quantity FROM orders', SCHEMA),
			['column quantity: unknown', 'table orders: resolved'],
		);
	});

	test('an unknown column records where it was looked for', () => {
		const analysis = testAnalyzer().analyze('SELECT quantity FROM orders', '');
		const column = resolveReferences(analysis, SCHEMA).find(reference => reference.kind === 'column')!;

		assert.deepStrictEqual(column.searched, ['sales.orders']);
	});

	test('a column is matched against the table it is qualified by', () => {
		// `name` is a column of customers but not of orders.
		assert.deepStrictEqual(
			judge('SELECT o.name FROM orders o, customers c', SCHEMA),
			['column name: unknown', 'table orders: resolved', 'table customers: resolved'],
		);
	});

	test('a column from any joined table resolves when unqualified', () => {
		assert.deepStrictEqual(
			judge('SELECT name FROM orders JOIN customers ON true', SCHEMA),
			['column name: resolved', 'table orders: resolved', 'table customers: resolved'],
		);
	});

	test('a column in a clause after the select is judged against its tables', () => {
		// `ORDER BY` hangs off the query rather than off the select inside it, so until the select
		// handed its tables up these were in a scope reading from nothing and went unjudged.
		assert.deepStrictEqual(
			judge('SELECT total FROM orders ORDER BY quantity', SCHEMA),
			['column total: resolved', 'table orders: resolved', 'column quantity: unknown'],
		);
	});

	test('an ORDER BY referring back to a select alias is not an unknown column', () => {
		// `t` is a name the statement made up, not a column of orders. Ordinary SQL, and the case
		// that judging `ORDER BY` at all would otherwise have started flagging. It renames `total`,
		// so it resolves as that column.
		assert.deepStrictEqual(
			judge('SELECT total AS t FROM orders ORDER BY t', SCHEMA),
			['column total: resolved', 'table orders: resolved', 'column t: resolved'],
		);
	});

	test('a select alias that renames a column resolves as that column', () => {
		// `WHERE uis = 10` is valid in SQLite, DuckDB and others; `uis` is `UnitsInStock`.
		const schema = schemaOf('products: ProductName, UnitsInStock');
		const references = resolveReferences(
			testAnalyzer().analyze('SELECT UnitsInStock AS uis FROM products p WHERE uis = 10', ''),
			schema,
		);
		const uis = references.filter(reference => reference.name === 'uis');

		assert.deepStrictEqual(
			uis.map(reference => [reference.aliasOf, reference.table?.name, reference.status]),
			[['UnitsInStock', 'products', 'resolved']],
		);
		assert.deepStrictEqual(
			judge('SELECT p.UnitsInStock AS uis FROM products p ORDER BY uis', schema),
			['column UnitsInStock: resolved', 'table products: resolved', 'column uis: resolved'],
		);
	});

	test('a select alias of anything but a column is left alone', () => {
		// There is no column behind `doubled` to resolve to, and it is not a mistake either.
		assert.deepStrictEqual(
			judge('SELECT total * 2 AS doubled FROM orders ORDER BY doubled', SCHEMA),
			['column total: resolved', 'table orders: resolved'],
		);
	});

	test('matching is case insensitive', () => {
		assert.deepStrictEqual(
			judge('SELECT TOTAL FROM ORDERS', SCHEMA),
			['column TOTAL: resolved', 'table ORDERS: resolved'],
		);
	});

	test('columns of an unknown table are not reported', () => {
		// The missing table is the mistake; a squiggle on each of its columns would be that one
		// mistake reported over and over.
		assert.deepStrictEqual(judge('SELECT quantity FROM invoices', SCHEMA), ['table invoices: unknown']);
	});

	test('a column qualified by an unknown table is not reported twice', () => {
		assert.deepStrictEqual(
			judge('SELECT i.quantity FROM invoices i', SCHEMA),
			['table invoices: unknown'],
		);
	});

	test('a CTE is not an unknown table', () => {
		assert.deepStrictEqual(
			judge('WITH recent AS (SELECT id FROM orders) SELECT id FROM recent', SCHEMA),
			['column id: resolved', 'table orders: resolved'],
		);
	});

	test('a CTE\'s own columns are not judged', () => {
		// The outer select cannot see `orders` at all, so `nonsense` may well be a real column of
		// the CTE's select list.
		assert.deepStrictEqual(
			judge('WITH recent AS (SELECT id FROM orders) SELECT nonsense FROM recent', SCHEMA),
			['column id: resolved', 'table orders: resolved'],
		);
	});

	test('a column qualified by a CTE alias is not judged', () => {
		assert.deepStrictEqual(
			judge('WITH recent AS (SELECT id FROM orders) SELECT r.nonsense FROM recent r', SCHEMA),
			['column id: resolved', 'table orders: resolved'],
		);
	});

	test('a derived table is not judged', () => {
		assert.deepStrictEqual(
			judge('SELECT nonsense FROM (SELECT id FROM orders) d', SCHEMA),
			['column id: resolved', 'table orders: resolved'],
		);
	});

	test('a scope mixing a known table and a derived one is not judged', () => {
		// The column may belong to the half that cannot be seen.
		assert.deepStrictEqual(
			judge('SELECT nonsense FROM orders JOIN (SELECT 1 AS n) d ON true', SCHEMA),
			['table orders: resolved'],
		);
	});

	test('a subquery is judged against its own tables, not the outer ones', () => {
		// `name` belongs to customers and not to orders, and is inside the subquery that reads
		// customers. A flat sweep would judge it against both and get it wrong either way.
		assert.deepStrictEqual(
			judge('SELECT total FROM orders WHERE id IN (SELECT name FROM customers)', SCHEMA),
			[
				'column total: resolved',
				'table orders: resolved',
				'column id: resolved',
				'column name: resolved',
				'table customers: resolved',
			],
		);
	});

	test('tables in writes are resolved too', () => {
		assert.deepStrictEqual(judge('DELETE FROM invoices', SCHEMA), ['table invoices: unknown']);
		assert.deepStrictEqual(
			judge('UPDATE orders SET total = 1', SCHEMA),
			['table orders: resolved', 'column total: resolved'],
		);
	});

	test('the object a CREATE defines is not reported as missing', () => {
		assert.deepStrictEqual(judge('CREATE TABLE brand_new (id int)', SCHEMA), []);
	});

	test('a statement that does not parse is not judged, and does not cost the others', () => {
		assert.deepStrictEqual(
			judge('SELECT * FRM invoices;\nSELECT * FROM customers', SCHEMA),
			['table customers: resolved'],
		);
	});

	test('an empty schema resolves nothing as known', () => {
		// The caller does not ask in this state, but nothing here should claim a name is wrong.
		assert.deepStrictEqual(
			judge('SELECT total FROM orders', new SchemaIndex()),
			['table orders: unknown'],
		);
	});

	test('references come back in document order', () => {
		// Diagnostics and links are both presented in the order the names appear.
		const analysis = testAnalyzer().analyze('SELECT total FROM orders', '');
		const starts = resolveReferences(analysis, SCHEMA).map(reference => reference.start);

		assert.deepStrictEqual(starts, [...starts].sort((left, right) => left - right));
	});
});
