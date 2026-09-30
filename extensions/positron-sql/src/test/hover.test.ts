/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { hoverFor } from '../hover';
import { SchemaIndex } from '../schemaIndex';
import { partialPayloadOf, schemaOf, sqlDocument, testAnalyzer } from './support';

const SCHEMA = schemaOf(
	'sales.orders: id: integer pk, total: numeric, placed_at: timestamp',
	'customers: id: integer pk, name: text',
);

/**
 * The hover shown over the first occurrence of `at` in a document.
 *
 * Positioned by naming the word rather than by counting characters, so a test reads as the thing
 * it is about and does not have to be recounted when the statement around it changes.
 */
async function hover(text: string, at: string, schema: SchemaIndex = SCHEMA): Promise<string | undefined> {
	const document = await sqlDocument(text);
	const offset = text.indexOf(at);
	assert.notStrictEqual(offset, -1, `'${at}' is not in the document`);

	const analysis = testAnalyzer().analyze(text, '');
	const shown = hoverFor(document, document.positionAt(offset), analysis, schema);
	if (!shown) {
		return undefined;
	}

	// The range matters as much as the text: a hover that highlights the wrong word is wrong even
	// when it says the right thing.
	assert.strictEqual(document.getText(shown.range), at, 'the hover covered the wrong text');
	return (shown.contents[0] as { value: string }).value;
}

suite('hoverFor', () => {

	test('a column shows its type and the table it came from', async () => {
		assert.strictEqual(
			await hover('SELECT total FROM orders', 'total'),
			[
				'```sql',
				'total numeric',
				'```',
				'',
				'Column of `sales.orders` in Test Connection',
			].join('\n'),
		);
	});

	test('a primary key says so', async () => {
		assert.strictEqual(
			await hover('SELECT id FROM orders', 'id'),
			[
				'```sql',
				'id integer',
				'```',
				'',
				'Primary key.',
				'',
				'Column of `sales.orders` in Test Connection',
			].join('\n'),
		);
	});

	test('an unqualified column names the table it resolved to', async () => {
		// The one thing nothing else says. In a join, `name` comes from exactly one of the tables,
		// and until the hover there was no way to see which.
		const shown = await hover('SELECT name FROM orders, customers', 'name');

		assert.ok(shown?.includes('Column of `customers`'), shown);
	});

	test('a column is shown as the database spells it, not as it was typed', async () => {
		// Names resolve case insensitively, so the two can differ, and what the database calls it
		// is what other tools will expect.
		const shown = await hover('SELECT TOTAL FROM orders', 'TOTAL');

		assert.ok(shown?.includes('total numeric'), shown);
	});

	test('a table shows where it lives and what columns it has', async () => {
		assert.strictEqual(
			await hover('SELECT * FROM orders', 'orders'),
			[
				'```sql',
				'sales.orders',
				'```',
				'',
				'Table in Test Connection',
				'',
				'| Column | Type |',
				'| --- | --- |',
				'| id (key) | integer |',
				'| total | numeric |',
				'| placed_at | timestamp |',
			].join('\n'),
		);
	});

	test('a table reached through an alias still hovers as itself', async () => {
		const shown = await hover('SELECT o.total FROM orders o', 'orders');

		assert.ok(shown?.includes('sales.orders'), shown);
	});

	test('a qualified column hovers over the column, not the qualifier', async () => {
		const shown = await hover('SELECT o.total FROM orders o', 'total');

		assert.ok(shown?.includes('total numeric'), shown);
	});

	test('a long table lists what fits and counts the rest', async () => {
		const wide = schemaOf(`wide: ${Array.from({ length: 20 }, (_, at) => `c${at}: integer`).join(', ')}`);
		const shown = await hover('SELECT * FROM wide', 'wide', wide);

		assert.ok(shown?.includes('| c14 | integer |'), shown);
		assert.ok(!shown?.includes('| c15 |'), 'the list should stop at the cap');
		assert.ok(shown?.includes('...and 5 more of 20 columns.'), shown);
	});

	test('a schema read only in part says its column list may be short', async () => {
		// The alternative is showing a partial list as though it were the whole table, which is
		// wrong rather than merely incomplete.
		const partial = new SchemaIndex(partialPayloadOf('orders: id: integer'));
		const shown = await hover('SELECT * FROM orders', 'orders', partial);

		assert.ok(shown?.includes('there may be more'), shown);
	});

	test('a name the connection does not have has no hover', async () => {
		// The squiggle already says so, and saying it again in a tooltip is the same news twice.
		assert.strictEqual(await hover('SELECT * FROM invoices', 'invoices'), undefined);
	});

	test('a CTE is not looked up in the database, having nothing to do with it', async () => {
		assert.strictEqual(
			await hover('WITH recent AS (SELECT * FROM orders) SELECT * FROM recent', 'recent'),
			undefined,
		);
	});

	test('a keyword has no hover', async () => {
		assert.strictEqual(await hover('SELECT * FROM orders', 'SELECT'), undefined);
	});

	test('a file with no connection to draw on has no hovers', async () => {
		assert.strictEqual(
			await hover('SELECT total FROM orders', 'total', new SchemaIndex()),
			undefined,
		);
	});
});
