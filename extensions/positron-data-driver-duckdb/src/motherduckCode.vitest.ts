/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { classifyMotherDuckOpenError, generateMotherDuckCode, motherduckLanguageIds, motherduckPath, scrubToken } from './motherduckCode';

const TOKEN = 'aaa.bbb.ccc';
const DB = 'sample_data';

describe('generateMotherDuckCode', () => {
	test('ggsql', () => {
		expect(generateMotherDuckCode('ggsql', { token: TOKEN, database: DB, readOnly: true })).toEqual([
			{ id: 'ggsql', label: 'ggsql', code: '-- @connect: duckdb://md:sample_data?motherduck_token=aaa.bbb.ccc' },
		]);
	});

	test('python read-only with token', () => {
		expect(generateMotherDuckCode('python', { token: TOKEN, database: DB, readOnly: true })).toEqual([
			{ id: 'duckdb', label: 'DuckDB', code: 'import duckdb\n\nconn = duckdb.connect("md:sample_data", read_only=True, config={"motherduck_token": "aaa.bbb.ccc"})\n' },
			{ id: 'sqlalchemy', label: 'SQLAlchemy', code: 'import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///md:sample_data", connect_args={"read_only": True, "config": {"motherduck_token": "aaa.bbb.ccc"}})\n' },
		]);
	});

	test('r read-only with token', () => {
		expect(generateMotherDuckCode('r', { token: TOKEN, database: DB, readOnly: true })).toEqual([
			{ id: 'dbi', label: 'DBI', code: 'library(DBI)\n\ninstall_con <- dbConnect(duckdb::duckdb())\ninvisible(dbExecute(install_con, "INSTALL motherduck"))\ndbDisconnect(install_con, shutdown = TRUE)\n\ncon <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data", read_only = TRUE, config = list(motherduck_token = "aaa.bbb.ccc"))\n' },
		]);
	});

	test('readOnly false drops read-only; ggsql unaffected', () => {
		const py = generateMotherDuckCode('python', { token: TOKEN, database: DB, readOnly: false });
		expect(py.map(v => v.code)).toEqual([
			'import duckdb\n\nconn = duckdb.connect("md:sample_data", config={"motherduck_token": "aaa.bbb.ccc"})\n',
			'import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///md:sample_data", connect_args={"config": {"motherduck_token": "aaa.bbb.ccc"}})\n',
		]);
		expect(generateMotherDuckCode('r', { token: TOKEN, database: DB, readOnly: false })[0].code)
			.toBe('library(DBI)\n\ninstall_con <- dbConnect(duckdb::duckdb())\ninvisible(dbExecute(install_con, "INSTALL motherduck"))\ndbDisconnect(install_con, shutdown = TRUE)\n\ncon <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data", config = list(motherduck_token = "aaa.bbb.ccc"))\n');
		expect(generateMotherDuckCode('ggsql', { token: TOKEN, database: DB, readOnly: false })[0].code)
			.toBe('-- @connect: duckdb://md:sample_data?motherduck_token=aaa.bbb.ccc');
	});

	test('undefined token drops the token everywhere', () => {
		const p = { token: undefined, database: DB, readOnly: true };
		expect(generateMotherDuckCode('ggsql', p)[0].code).toBe('-- @connect: duckdb://md:sample_data');
		expect(generateMotherDuckCode('python', p).map(v => v.code)).toEqual([
			'import duckdb\n\nconn = duckdb.connect("md:sample_data", read_only=True)\n',
			'import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///md:sample_data", connect_args={"read_only": True})\n',
		]);
		expect(generateMotherDuckCode('r', p)[0].code)
			.toBe('library(DBI)\n\ninstall_con <- dbConnect(duckdb::duckdb())\ninvisible(dbExecute(install_con, "INSTALL motherduck"))\ndbDisconnect(install_con, shutdown = TRUE)\n\ncon <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data", read_only = TRUE)\n');
	});

	test('undefined token, not read-only, python has no empty config or connect_args', () => {
		const p = { token: undefined, database: DB, readOnly: false };
		expect(generateMotherDuckCode('python', p).map(v => v.code)).toEqual([
			'import duckdb\n\nconn = duckdb.connect("md:sample_data")\n',
			'import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///md:sample_data")\n',
		]);
		expect(generateMotherDuckCode('r', p)[0].code)
			.toBe('library(DBI)\n\ninstall_con <- dbConnect(duckdb::duckdb())\ninvisible(dbExecute(install_con, "INSTALL motherduck"))\ndbDisconnect(install_con, shutdown = TRUE)\n\ncon <- dbConnect(duckdb::duckdb(), dbdir = "md:sample_data")\n');
	});

	test('blank database gives md:', () => {
		for (const database of [undefined, '  ']) {
			expect(generateMotherDuckCode('python', { token: undefined, database, readOnly: false })[0].code)
				.toBe('import duckdb\n\nconn = duckdb.connect("md:")\n');
		}
	});

	test('escapes quotes in the database name', () => {
		const p = { token: undefined, database: 'my"db', readOnly: false };
		expect(generateMotherDuckCode('python', p)[0].code).toContain('"md:my\\"db"');
		expect(generateMotherDuckCode('r', p)[0].code).toContain('"md:my\\"db"');
	});

	test('escapes quotes and backslashes in the token', () => {
		const p = { token: 'a"b\\c', database: undefined, readOnly: false };
		expect(generateMotherDuckCode('python', p).map(v => v.code)).toEqual([
			'import duckdb\n\nconn = duckdb.connect("md:", config={"motherduck_token": "a\\"b\\\\c"})\n',
			'import sqlalchemy as sa\n\nengine = sa.create_engine("duckdb:///md:", connect_args={"config": {"motherduck_token": "a\\"b\\\\c"}})\n',
		]);
		expect(generateMotherDuckCode('r', p)[0].code).toContain('config = list(motherduck_token = "a\\"b\\\\c")');
	});

	test('unknown language returns no variants', () => {
		expect(generateMotherDuckCode('julia', { token: TOKEN, database: DB, readOnly: true })).toEqual([]);
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

	test('other', () => {
		expect(classifyMotherDuckOpenError('Catalog Error: Table with name t does not exist!')).toBe('other');
	});
});
