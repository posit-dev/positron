/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { connectIn, normalizeConnect, skippedByRender } from '../connect';

suite('skippedByRender', () => {

	test('a cell is skipped by an eval: false among its leading option lines only', () => {
		assert.deepStrictEqual([
			skippedByRender('--| label: q\n--| eval: false\n-- @connect: duckdb://a.db\nSELECT 1;'),
			skippedByRender('#| eval: FALSE\nSELECT 1;'),
			// a YAML comment after it, which Positron's YAML parse of the line reads past
			skippedByRender('--| eval: false  # draft only\nSELECT 1;'),
			skippedByRender('--| eval: true\nSELECT 1;'),
			// after the option lines, it is a comment
			skippedByRender('SELECT 1;\n--| eval: false'),
		], [true, true, true, false, false]);
	});
});

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

	test('a cell\'s directives end where the kernel stops reading them', () => {
		// options are stripped only from the very top: after a blank line, one is code to the kernel
		assert.strictEqual(connectIn('\n--| label: q\n-- @connect: duckdb://a.db\nSELECT 1;', true), undefined);
		// and the kernel knows no other directive than @connect and @uncache
		assert.strictEqual(connectIn('-- @typo\n-- @connect: duckdb://a.db\nSELECT 1;', true), undefined);
		assert.strictEqual(connectIn('-- @uncache\n-- @connect: duckdb://a.db\nSELECT 1;', true), 'duckdb://a.db');
	});

	test('only the exact directive counts, not a mention of it', () => {
		assert.strictEqual(connectIn('--@connect: duckdb://a.db', false), undefined);
		assert.strictEqual(connectIn('SELECT \'-- @connect: duckdb://a.db\';', false), undefined);
		assert.strictEqual(connectIn('-- @connect:   ', false), undefined);
	});
});

suite('normalizeConnect', () => {
	const base = '/work/report';

	test('a relative database file is the one beside the document', () => {
		assert.strictEqual(normalizeConnect('duckdb://data/sales.db', base, path.posix), 'duckdb:///work/report/data/sales.db');
		assert.strictEqual(normalizeConnect('sqlite:///db/x.sqlite', base, path.posix), 'sqlite:///db/x.sqlite');
	});

	test('on Windows, a driver\'s line and a document\'s relative path name the same file', () => {
		// a driver writes forward slashes and the drive letter as picked; fsPath lowercases it
		const driver = normalizeConnect('duckdb://C:/proj/data/sales.db', undefined, path.win32);
		const user = normalizeConnect('duckdb://data/sales.db', 'c:\\proj', path.win32);
		assert.deepStrictEqual([driver, user], ['duckdb://c:/proj/data/sales.db', 'duckdb://c:/proj/data/sales.db']);
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
