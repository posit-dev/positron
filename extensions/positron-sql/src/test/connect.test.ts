/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { connectIn, normalizeConnect } from '../connect';

suite('connectIn', () => {

	test('a file is read for its first @connect line, wherever it is', () => {
		const text = 'SELECT 1;\n-- @connect: duckdb://a.db\nSELECT 2;\n-- @connect: duckdb://b.db\n';
		assert.strictEqual(connectIn(text, false), 'duckdb://a.db');
	});

	test('a cell is read only for its leading directives, the last of which wins', () => {
		const cell = '--| label: q\n\n-- @connect: duckdb://a.db\n-- @uncache\n-- @connect: duckdb://b.db\nSELECT 1;';
		assert.strictEqual(connectIn(cell, true), 'duckdb://b.db');
		assert.strictEqual(connectIn('SELECT 1;\n-- @connect: duckdb://a.db', true), undefined);
	});

	test('only the exact directive counts, not a mention of it', () => {
		assert.strictEqual(connectIn('--@connect: duckdb://a.db', false), undefined);
		assert.strictEqual(connectIn('SELECT \'-- @connect: duckdb://a.db\';', false), undefined);
		assert.strictEqual(connectIn('-- @connect:   ', false), undefined);
	});
});

suite('normalizeConnect', () => {
	const base = path.resolve('/work/report');

	test('a relative database file is the one beside the document', () => {
		assert.strictEqual(
			normalizeConnect('duckdb://data/sales.db', base),
			`duckdb://${path.resolve(base, 'data/sales.db')}`,
		);
		assert.strictEqual(
			normalizeConnect(`sqlite://${path.resolve('/db/x.sqlite')}`, base),
			`sqlite://${path.resolve('/db/x.sqlite')}`,
		);
	});

	test('options do not change which database it is', () => {
		assert.strictEqual(
			normalizeConnect('duckdb://md:sales?access_mode=read_only', base),
			normalizeConnect('duckdb://md:sales', undefined),
		);
	});

	test('databases that are not files, and other schemes, are left as written', () => {
		assert.strictEqual(normalizeConnect('duckdb://memory', base), 'duckdb://memory');
		assert.strictEqual(normalizeConnect('postgres://host/db', base), 'postgres://host/db');
		assert.strictEqual(normalizeConnect('duckdb://rel.db', undefined), 'duckdb://rel.db');
	});
});
