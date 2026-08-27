/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Cursor, readCursor } from '../cursor';

/** Reads the cursor from text that marks its position with `|`. */
function at(marked: string): Cursor {
	const offset = marked.indexOf('|');
	assert.notStrictEqual(offset, -1, 'the text must mark the cursor with |');
	return readCursor(marked.replace('|', ''), offset);
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
		const cursor = at('SELECT o.[Order T| FROM orders o');

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
