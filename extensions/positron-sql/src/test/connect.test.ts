/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { cellsWithNewConnect, connectIn, ggsqlConnectOf, normalizeConnect } from '../connect';

suite('connectIn', () => {

	test('a file is read for its first @connect line, wherever it is', () => {
		const text = 'SELECT 1;\n-- @connect: duckdb://a.db\nSELECT 2;\n-- @connect: duckdb://b.db\n';
		assert.strictEqual(connectIn(text), 'duckdb://a.db');
	});

	test('only the exact directive counts, not a mention of it', () => {
		assert.strictEqual(connectIn('--@connect: duckdb://a.db'), undefined);
		assert.strictEqual(connectIn('SELECT \'-- @connect: duckdb://a.db\';'), undefined);
		assert.strictEqual(connectIn('-- @connect:   '), undefined);
	});
});

suite('ggsqlConnectOf', () => {

	test('reads the database Positron gives a Quarto cell, and whether it runs in ggsql at all', () => {
		assert.deepStrictEqual([
			ggsqlConnectOf({ ggsqlConnect: 'duckdb://a.db' }),
			// runs in ggsql, names no database
			ggsqlConnectOf({ ggsqlConnect: '' }),
			// does not run in ggsql: no key, or a key Positron cleared
			ggsqlConnectOf({}),
			ggsqlConnectOf({ ggsqlConnect: undefined }),
		], ['duckdb://a.db', '', undefined, undefined]);
	});
});

suite('cellsWithNewConnect', () => {

	test('names the hidden notebook\'s cells whose metadata changed, and nothing else', () => {
		const change = (document: string, metadata?: object) => ({ cell: { document }, metadata });
		assert.deepStrictEqual([
			cellsWithNewConnect({ notebook: { notebookType: 'quarto-cells' }, cellChanges: [change('a', { ggsqlConnect: 'duckdb://a.db' }), change('b'), change('c', {})] }),
			// a change to some other notebook says nothing about Quarto cells
			cellsWithNewConnect({ notebook: { notebookType: 'jupyter-notebook' }, cellChanges: [change('a', {})] }),
		], [['a', 'c'], []]);
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
