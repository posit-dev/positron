/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	createQueryCodeGenerator,
	dbiGetQuery,
	duckdbRelational,
	pandasReadSql,
	pythonStringLiteral,
	rStringLiteral,
} from '../queryCode.js';

// The quoting and the recipes are tested here, once, for every driver that uses them. A driver's
// own test asserts only the part that is its own: which variant ids map to which recipe.

suite('Query Code Quoting', () => {

	test('a query carrying quotes, backslashes, and newlines is quoted rather than broken', () => {
		// R escapes both characters. Python's triple-quoted form leaves a lone quote alone, and the
		// newline padding keeps a query that ends in a quote from running into the delimiter.
		const sql = 'SELECT "a\\b"\nFROM t';
		assert.deepStrictEqual(
			{
				python: pythonStringLiteral(sql),
				r: rStringLiteral(sql),
			},
			{
				python: '"""\nSELECT "a\\\\b"\nFROM t\n"""',
				r: '"SELECT \\"a\\\\b\\"\nFROM t"',
			}
		);
	});

	test('a query ending in a double quote does not run into the Python delimiter', () => {
		// Without the trailing newline the closing `"""` would read as a fourth quote.
		assert.strictEqual(pythonStringLiteral('SELECT "t"'), '"""\nSELECT "t"\n"""');
	});

	test('an embedded triple quote cannot close the Python literal early', () => {
		assert.strictEqual(pythonStringLiteral('SELECT """'), '"""\nSELECT \\"\\"\\"\n"""');
	});
});

suite('Query Code Recipes', () => {

	test('pandas reads the query through a connection and returns a data frame', () => {
		assert.strictEqual(pandasReadSql('conn', 'SELECT 1'),
			'import pandas as pd\n\npd.read_sql_query("""\nSELECT 1\n""", conn)');
	});

	test('the DuckDB relational API returns a data frame without a pandas import', () => {
		assert.strictEqual(duckdbRelational('conn', 'SELECT 1'), 'conn.sql("""\nSELECT 1\n""").df()');
	});

	test('R code queries the DBI connection, qualified so it needs no library() line', () => {
		assert.strictEqual(dbiGetQuery('con', 'SELECT 1'), 'DBI::dbGetQuery(con, "SELECT 1")');
	});
});

suite('Query Code Generator', () => {

	const generate = createQueryCodeGenerator({
		python: { dbapi: pandasReadSql, sqlalchemy: pandasReadSql },
		r: { dbi: dbiGetQuery },
	});

	test('a mapped variant is generated with the recipe it names, in the named language', () => {
		assert.deepStrictEqual(
			{
				dbapi: generate({ languageId: 'python', variantId: 'dbapi', connectionVariable: 'conn', query: 'SELECT 1' }),
				sqlalchemy: generate({ languageId: 'python', variantId: 'sqlalchemy', connectionVariable: 'engine', query: 'SELECT 1' }),
				dbi: generate({ languageId: 'r', variantId: 'dbi', connectionVariable: 'con', query: 'SELECT 1' }),
			},
			{
				dbapi: 'import pandas as pd\n\npd.read_sql_query("""\nSELECT 1\n""", conn)',
				sqlalchemy: 'import pandas as pd\n\npd.read_sql_query("""\nSELECT 1\n""", engine)',
				dbi: 'DBI::dbGetQuery(con, "SELECT 1")',
			}
		);
	});

	test('nothing is generated for a variant or a language the map does not name', () => {
		assert.deepStrictEqual(
			{
				unknownVariant: generate({ languageId: 'python', variantId: 'pyodbc', connectionVariable: 'conn', query: 'SELECT 1' }),
				unknownLanguage: generate({ languageId: 'julia', variantId: 'dbapi', connectionVariable: 'conn', query: 'SELECT 1' }),
			},
			{ unknownVariant: undefined, unknownLanguage: undefined }
		);
	});

	test('an id naming an Object.prototype member resolves to nothing, not to an inherited value', () => {
		// Both ids arrive from outside the driver, so a plain object lookup would be a way to reach
		// something that is not a recipe and call it.
		assert.deepStrictEqual(
			{
				language: generate({ languageId: 'constructor', variantId: 'dbi', connectionVariable: 'con', query: 'SELECT 1' }),
				variant: generate({ languageId: 'python', variantId: '__proto__', connectionVariable: 'conn', query: 'SELECT 1' }),
			},
			{ language: undefined, variant: undefined }
		);
	});
});
