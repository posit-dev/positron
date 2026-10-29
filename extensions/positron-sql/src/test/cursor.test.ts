/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Cursor, readCursor } from '../cursor';

/** Reads the cursor from text that marks its position with `|`. */
function at(marked: string, dialect = ''): Cursor {
	const offset = marked.indexOf('|');
	assert.notStrictEqual(offset, -1, 'the text must mark the cursor with |');
	return readCursor(marked.replace('|', ''), offset, dialect);
}

suite('readCursor', () => {

	test('reads the partial identifier under the cursor', () => {
		const cursor = at('SELECT cus| FROM t');

		assert.strictEqual(cursor.prefix, 'cus');
		assert.strictEqual(cursor.prefixStart, 7);
		assert.deepStrictEqual(cursor.qualifiers, []);
	});

	test('an empty prefix replaces nothing', () => {
		const cursor = at('SELECT | FROM t');

		assert.strictEqual(cursor.prefix, '');
		assert.strictEqual(cursor.prefixStart, 7);
	});

	test('reads the qualifier in front of a dot', () => {
		assert.deepStrictEqual(at('SELECT o.| FROM orders o').qualifiers, ['o']);
		assert.deepStrictEqual(at('SELECT o.tot| FROM orders o').qualifiers, ['o']);
	});

	test('reads a dotted chain of qualifiers, outermost first', () => {
		assert.deepStrictEqual(at('SELECT * FROM sales.orders.|').qualifiers, ['sales', 'orders']);
	});

	test('a quoted qualifier is read whole', () => {
		// Read backwards from the dot, so the closing quote is what says where it starts.
		assert.deepStrictEqual(at('SELECT "Order Details".| FROM t').qualifiers, ['Order Details']);
	});

	test('reads a half typed quoted identifier as the prefix', () => {
		const cursor = at('SELECT o."Order T| FROM orders o');

		assert.strictEqual(cursor.prefix, 'Order T');
		assert.deepStrictEqual(cursor.qualifiers, ['o']);
		assert.strictEqual(cursor.quoted, true);
	});

	test('a half typed bracket identifier works the same way', () => {
		const cursor = at('SELECT o.[Order T| FROM orders o', 'tsql');

		assert.strictEqual(cursor.prefix, 'Order T');
		assert.deepStrictEqual(cursor.qualifiers, ['o']);
	});

	test('nothing is completed inside a string literal', () => {
		assert.strictEqual(at('SELECT \'some tex|').suppressed, true);
	});

	test('nothing is completed inside a line comment', () => {
		assert.strictEqual(at('SELECT 1 -- a note her|').suppressed, true);
	});

	test('completion resumes after a closed string', () => {
		assert.strictEqual(at('SELECT \'done\', cus|').suppressed, false);
		assert.strictEqual(at('SELECT \'done\', cus|').prefix, 'cus');
	});

	test('an escaped quote does not end the literal', () => {
		assert.strictEqual(at('SELECT \'it\'\'s still a string|').suppressed, true);
	});

	test('a string on the line above does not suppress the line below', () => {
		// Only the cursor's own line is scanned, so a closed literal earlier in the document
		// cannot leak its state forward.
		assert.strictEqual(at('SELECT \'a\'\nFROM cus|').suppressed, false);
	});

	test('nothing is completed inside a block comment, even one opened lines above', () => {
		assert.strictEqual(at('SELECT /* ord| */ 1').suppressed, true);
		assert.strictEqual(at('/* a note\nthat goes on ord|\n*/ SELECT 1').suppressed, true);
		assert.strictEqual(at('/* it\'s fine */ SELECT ord|').suppressed, false);
	});

	test('a string literal spanning lines is tracked across them', () => {
		assert.strictEqual(at('SELECT \'a\nb| \' FROM t').suppressed, true);
		assert.strictEqual(at('SELECT \'a\nb\' AS x, ord| FROM t').suppressed, false);
	});

	test('a string that never closes ends with its line', () => {
		// The analyzer closes it there too, so the two agree that the next line is code.
		assert.strictEqual(at('SELECT \'oops\nSELECT ord|').suppressed, false);
		assert.strictEqual(at('SELECT \'oops ord|').suppressed, true);
	});

	test('nothing is completed inside a dollar quoted body', () => {
		assert.strictEqual(at('CREATE FUNCTION f() AS $$ SELECT ord| $$').suppressed, true);
		assert.strictEqual(at('DO $body$ BEGIN ord| END $body$').suppressed, true);
		assert.strictEqual(at('SELECT $$x$$, ord|').suppressed, false);
		// A parameter is not a dollar quote.
		assert.strictEqual(at('SELECT $1, ord|').suppressed, false);
	});

	test('an empty document is a cursor with nothing around it', () => {
		const cursor = readCursor('', 0);

		assert.strictEqual(cursor.prefix, '');
		assert.strictEqual(cursor.suppressed, false);
		assert.deepStrictEqual(cursor.qualifiers, []);
	});
});

suite('replaceStart', () => {

	test('an ordinary prefix is replaced from its first character', () => {
		const cursor = at('SELECT cus| FROM t');

		assert.strictEqual(cursor.replaceStart, cursor.prefixStart);
	});

	test('a quoted prefix is replaced from its opening quote', () => {
		// A completion that needs quoting inserts them itself, so an edit starting after the
		// quote would turn `o."Order T` into `o.""Order Total"`.
		const cursor = at('SELECT o."Order T| FROM orders o');

		assert.strictEqual(cursor.replaceStart, cursor.prefixStart - 1);
	});
});

suite('replaceEnd', () => {

	test('an edit ends at the cursor', () => {
		assert.deepStrictEqual(
			[at('SELECT cus| FROM t').replaceEnd, at('SELECT o."Order T| FROM t').replaceEnd],
			[10, 17],
		);
	});

	test('a quote the editor closed at the cursor is replaced too', () => {
		// Typing `"` inserts `""`. Each completion brings its own closing quote.
		assert.deepStrictEqual(
			[at('SELECT o."Order T|" FROM t').replaceEnd, at('SELECT o.`Ord|` FROM t').replaceEnd],
			[18, 14],
		);
	});
});

suite('wordEnd', () => {

	test('a replacing edit takes in the rest of the word the cursor is in', () => {
		// So that replace mode turns `o.cu|st` into `o.customer_id`, not `o.customer_idst`.
		const cursor = at('SELECT o.cu|st FROM t');

		assert.deepStrictEqual([cursor.replaceEnd, cursor.wordEnd], [11, 13]);
	});

	test('inside a quoted name, both edits take in the whole name', () => {
		const cursor = at('SELECT o."Ord|er Total" FROM t');

		assert.deepStrictEqual([cursor.replaceStart, cursor.replaceEnd, cursor.wordEnd], [9, 22, 22]);
	});

	test('a quote just typed does not reach the next quoted name on the line', () => {
		// The `"` opening `"orders"` is not the close of the one just typed.
		const cursor = at('SELECT "| FROM "orders"');

		assert.deepStrictEqual([cursor.replaceEnd, cursor.wordEnd], [8, 8]);
	});
});

suite('dialects', () => {

	test('a backslash escapes a quote where the dialect says it does', () => {
		const text = 'SELECT * FROM t WHERE name = \'O\\\'Brien\' AND ord|';

		assert.deepStrictEqual(
			['mysql', 'bigquery', 'databricks', 'postgres'].map(dialect => at(text, dialect).suppressed),
			[false, false, false, true],
		);
	});

	test('an E string takes backslash escapes in any dialect', () => {
		assert.strictEqual(at('SELECT E\'a\\\'b\', ord|', 'postgres').suppressed, false);
		// A word ending in `e` is not an E prefix: `date'...'` is a typed literal, whose backslash
		// is an ordinary character.
		assert.strictEqual(at('SELECT * FROM t WHERE d = date\'a\\\' AND ord|', 'postgres').suppressed, false);
	});

	test('a double quote opens a string in a dialect that quotes names with backticks', () => {
		assert.deepStrictEqual(
			[at('SELECT * FROM t WHERE name = "|"', 'bigquery'), at('SELECT o."|" FROM t', 'postgres')]
				.map(cursor => [cursor.suppressed, cursor.quoted]),
			[[true, false], [false, true]],
		);
	});

	test('a bracket quotes a name only where the dialect says it does', () => {
		// Elsewhere it is a list or an array, and what is typed inside one is an expression.
		assert.deepStrictEqual(
			[
				at('SELECT [o.| FROM orders o', 'duckdb'),
				at('SELECT ARRAY[o.| FROM orders o', 'postgres'),
				at('SELECT [o.| FROM orders o', 'tsql'),
			].map(cursor => [cursor.quoted, cursor.qualifiers]),
			[[false, ['o']], [false, ['o']], [true, []]],
		);
	});

	test('a hash starts a comment only where the dialect says it does', () => {
		assert.deepStrictEqual(
			['mysql', 'mariadb', 'bigquery', 'postgres'].map(dialect => at('SELECT 1 # see ord|', dialect).suppressed),
			[true, true, true, false],
		);
	});
});
