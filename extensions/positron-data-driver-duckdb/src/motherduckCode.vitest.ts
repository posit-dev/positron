/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { classifyMotherDuckOpenError, generateMotherDuckCode, motherduckLanguageIds, motherduckPath, scrubToken } from './motherduckCode';

const TOKEN = 'aaa.bbb.ccc';
const DB = 'sample_data';

describe('generateMotherDuckCode', () => {
	const COMMENT = '# MotherDuck reads your access token from the motherduck_token environment variable.\n';
	const R_INSTALL = 'library(DBI)\n\ninstall_con <- dbConnect(duckdb::duckdb())\ninvisible(dbExecute(install_con, "INSTALL motherduck"))\ndbDisconnect(install_con, shutdown = TRUE)\n\n';

	test('ggsql adds access_mode only when read-only', () => {
		expect(generateMotherDuckCode('ggsql', { database: DB, readOnly: true })).toEqual([
			{ id: 'ggsql', label: 'ggsql', code: '-- @connect: duckdb://md:sample_data?access_mode=read_only' },
		]);
		expect(generateMotherDuckCode('ggsql', { database: DB, readOnly: false })[0].code)
			.toBe('-- @connect: duckdb://md:sample_data');
	});

	test('python read-only', () => {
		expect(generateMotherDuckCode('python', { database: DB, readOnly: true })).toEqual([
			{ id: 'duckdb', label: 'duckdb', code: `import duckdb\n\n${COMMENT}conn = duckdb.connect("md:sample_data", read_only=True)\n` },
			{ id: 'sqlalchemy', label: 'SQLAlchemy', code: `import sqlalchemy as sa\n\n${COMMENT}engine = sa.create_engine("duckdb:///md:sample_data", connect_args={"read_only": True})\n` },
		]);
	});

	test('r read-only', () => {
		expect(generateMotherDuckCode('r', { database: DB, readOnly: true })).toEqual([
			{ id: 'dbi', label: 'DBI', code: `${R_INSTALL}${COMMENT}con <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data", read_only = TRUE)\n` },
		]);
	});

	test('readOnly false drops read-only everywhere', () => {
		expect(generateMotherDuckCode('python', { database: DB, readOnly: false }).map(v => v.code)).toEqual([
			`import duckdb\n\n${COMMENT}conn = duckdb.connect("md:sample_data")\n`,
			`import sqlalchemy as sa\n\n${COMMENT}engine = sa.create_engine("duckdb:///md:sample_data")\n`,
		]);
		expect(generateMotherDuckCode('r', { database: DB, readOnly: false })[0].code)
			.toBe(`${R_INSTALL}${COMMENT}con <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data")\n`);
	});

	test('no variant passes a token', () => {
		for (const languageId of ['ggsql', 'python', 'r']) {
			for (const readOnly of [true, false]) {
				for (const variant of generateMotherDuckCode(languageId, { database: DB, readOnly })) {
					expect(variant.code).not.toContain('config');
					expect(variant.code).not.toContain('motherduck_token=');
					expect(variant.code).not.toContain('"motherduck_token"');
				}
			}
		}
	});

	test('blank database gives md:', () => {
		for (const database of [undefined, '  ']) {
			expect(generateMotherDuckCode('python', { database, readOnly: false })[0].code)
				.toBe(`import duckdb\n\n${COMMENT}conn = duckdb.connect("md:")\n`);
		}
	});

	test('escapes quotes in the database name', () => {
		const p = { database: 'my"db', readOnly: false };
		expect(generateMotherDuckCode('python', p)[0].code).toContain('"md:my\\"db"');
		expect(generateMotherDuckCode('r', p)[0].code).toContain('"md:my\\"db"');
	});

	test('escapes newlines, carriage returns, and tabs', () => {
		const p = { database: 'a\nb\rc\td', readOnly: false };
		expect(generateMotherDuckCode('python', p)[0].code).toContain('"md:a\\nb\\rc\\td"');
		expect(generateMotherDuckCode('r', p)[0].code).toContain('"md:a\\nb\\rc\\td"');
	});

	test('unknown language returns no variants', () => {
		expect(generateMotherDuckCode('julia', { database: DB, readOnly: true })).toEqual([]);
	});
});

describe('motherduckPath', () => {
	test('trims and handles blanks', () => {
		expect(motherduckPath(' sample_data ')).toBe('md:sample_data');
		expect(motherduckPath('')).toBe('md:');
		expect(motherduckPath(undefined)).toBe('md:');
	});
});

describe('motherduckLanguageIds', () => {
	test('leaves out R on Windows only', () => {
		expect({
			win32: motherduckLanguageIds('win32'),
			darwin: motherduckLanguageIds('darwin'),
			linux: motherduckLanguageIds('linux'),
		}).toEqual({
			win32: ['python', 'ggsql'],
			darwin: ['python', 'r', 'ggsql'],
			linux: ['python', 'r', 'ggsql'],
		});
	});
});

describe('scrubToken', () => {
	test('replaces every occurrence', () => {
		expect(scrubToken('x aaa.bbb.ccc y aaa.bbb.ccc', TOKEN)).toBe('x <redacted> y <redacted>');
	});

	test('leaves text alone for blank or undefined token', () => {
		expect(scrubToken('hello', undefined)).toBe('hello');
		expect(scrubToken('hello', '')).toBe('hello');
		expect(scrubToken('hello  x', '  ')).toBe('hello  x');
	});
});

describe('classifyMotherDuckOpenError', () => {
	test('auth', () => {
		expect(classifyMotherDuckOpenError('Invalid Input Error: Initialization function "motherduck_duckdb_cpp_init" from file "/x/motherduck.duckdb_extension" threw an exception: "Invalid Error: Request failed: Your request is not authenticated. Please check your MotherDuck token. (Jwt is not in the form of Header.Payload.Signature with two dots and 3 sections, request id: \'r\')"')).toBe('auth');
	});

	test('extensionDownload', () => {
		expect(classifyMotherDuckOpenError('IO Error: Failed to download extension "motherduck" at URL "http://127.0.0.1:9/v1.5.5/osx_arm64/motherduck.duckdb_extension.gz"')).toBe('extensionDownload');
	});

	test('databaseNotFound', () => {
		expect(classifyMotherDuckOpenError('Invalid Input Error: Initialization function "motherduck_duckdb_cpp_init" from file "/x/motherduck.duckdb_extension" threw an exception: "Failed to attach \'1abc\': no database/share named "1abc" found')).toBe('databaseNotFound');
	});

	test('other', () => {
		expect(classifyMotherDuckOpenError('Catalog Error: Table with name t does not exist!')).toBe('other');
	});
});
