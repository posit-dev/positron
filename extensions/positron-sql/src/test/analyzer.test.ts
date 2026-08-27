/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { testAnalyzer } from './support';

/**
 * The WebAssembly module, driven through its TypeScript wrapper.
 *
 * What the analysis itself produces is pinned down by the crate's own tests, which can cover it
 * far more cheaply. These are about the boundary: that the module loads, that strings and offsets
 * survive the crossing, and that a caller gets an answer rather than an exception.
 */
suite('SqlAnalyzer', () => {

	test('splits a document into statements', () => {
		assert.deepStrictEqual(
			testAnalyzer().statements('SELECT 1; SELECT 2', ''),
			[
				{ start: 0, end: 9, terminated: true },
				{ start: 10, end: 18, terminated: false },
			],
		);
	});

	test('reports a syntax error with the range of the offending token', () => {
		const text = 'SELECT * FRM customers';
		const diagnostics = testAnalyzer().analyze(text, '').diagnostics;

		assert.strictEqual(diagnostics.length, 1);
		assert.strictEqual(text.slice(diagnostics[0].start, diagnostics[0].end), 'FRM');
	});

	test('offsets count UTF-16 units, as an editor does', () => {
		// The emoji is one Unicode scalar value and two UTF-16 units. Getting this wrong would put
		// every squiggle in the document one column to the left of where it belongs.
		const text = 'SELECT \'\u{1F600}\' FROM t GROUP';
		const diagnostics = testAnalyzer().analyze(text, '').diagnostics;

		assert.strictEqual(diagnostics.length, 1);
		assert.strictEqual(text.slice(diagnostics[0].start, diagnostics[0].end), 'GROUP');
	});

	test('reads the tables of a statement that does not parse', () => {
		// The state completion is always asked about: an empty select list is not valid SQL. A
		// namespace level the statement did not name is absent rather than null, so that the
		// optional fields on the TypeScript side really do read as undefined.
		assert.deepStrictEqual(
			testAnalyzer().sources('SELECT  FROM sales.orders o', '', 7),
			[{ name: 'orders', schema: 'sales', alias: 'o' }],
		);
	});

	test('the dialect reaches the parser', () => {
		const text = 'SELECT `total` FROM orders';

		assert.strictEqual(testAnalyzer().analyze(text, 'mysql').diagnostics.length, 0);
		assert.strictEqual(testAnalyzer().analyze(text, 'postgres').diagnostics.length, 1);
	});

	test('offers keywords', () => {
		const keywords = testAnalyzer().keywords();

		assert.ok(keywords.includes('SELECT'));
		assert.ok(keywords.includes('GROUP BY'), 'multi-word keywords are offered whole');
	});

	test('a dialect renamed since the setting was written still resolves', () => {
		// A user who picked `tsql` from the settings list meant Transact-SQL, which sqlparser
		// spells `mssql`. Falling back to generic would quietly stop honouring their choice.
		const text = 'SELECT TOP 5 [total] FROM [orders]';

		assert.deepStrictEqual(testAnalyzer().analyze(text, 'tsql').diagnostics, []);
		assert.strictEqual(testAnalyzer().analyze(text, 'tsql').unknownDialect, false);
	});

	test('an unrecognized dialect says so rather than parsing as something else in silence', () => {
		assert.strictEqual(testAnalyzer().analyze('SELECT 1', 'not-a-dialect').unknownDialect, true);
		assert.strictEqual(testAnalyzer().analyze('SELECT 1', '').unknownDialect, false);
	});

	test('a large document is analyzed without exhausting the module', () => {
		// Every request allocates in the module's memory and frees it again; a leak here would
		// show up as a growing document eventually failing rather than as a wrong answer.
		const text = 'SELECT id, name FROM customers WHERE id > 1;\n'.repeat(500);

		for (let round = 0; round < 3; round++) {
			assert.strictEqual(testAnalyzer().analyze(text, '').diagnostics.length, 0);
		}
		assert.strictEqual(testAnalyzer().statements(text, '').length, 500);
	});
});
