/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { bindConnectionToFreeVariable, extractConnectionVariableName } from '../../common/dataConnectionCode.js';

describe('extractConnectionVariableName', () => {

	it('reads the name a Python snippet binds', () => {
		expect(extractConnectionVariableName('import psycopg2\n\nconn = psycopg2.connect(\n\thost="db",\n)\n'))
			.toBe('conn');
	});

	it('reads the name an R snippet binds', () => {
		expect(extractConnectionVariableName('library(DBI)\n\ncon <- dbConnect(\n\tRPostgres::Postgres()\n)\n'))
			.toBe('con');
	});

	it('takes the last top-level assignment, not the first', () => {
		// A driver may emit a preparatory statement before the real bind line.
		expect(extractConnectionVariableName('url = build_url()\nengine = create_engine(url)\n'))
			.toBe('engine');
	});

	it('ignores indented assignments, which are keyword arguments', () => {
		expect(extractConnectionVariableName('conn = connect(\n\thost = "db",\n)\n')).toBe('conn');
	});

	it('has no name for a snippet that binds nothing', () => {
		expect(extractConnectionVariableName('DBI::dbConnect(RSQLite::SQLite())\n')).toBeUndefined();
	});
});

describe('bindConnectionToFreeVariable', () => {

	it('leaves the driver\'s own name alone when it is free', () => {
		// The ordinary case, one connection in a session, must look exactly as the driver wrote it.
		expect(bindConnectionToFreeVariable('conn = connect()\n', ['orders', 'df']))
			.toEqual({ code: 'conn = connect()\n', variableName: 'conn' });
	});

	it('renames when the session already holds that name', () => {
		expect(bindConnectionToFreeVariable('conn = connect()\n', ['conn']))
			.toEqual({ code: 'conn_2 = connect()\n', variableName: 'conn_2' });
	});

	it('keeps counting past names already taken by earlier renames', () => {
		expect(bindConnectionToFreeVariable('conn = connect()\n', ['conn', 'conn_2', 'conn_3']).variableName)
			.toBe('conn_4');
	});

	it('renames every mention, not only the assignment', () => {
		// A driver is free to refer back to the connection it made, and renaming only the binding
		// would leave the follow-up line pointing at a name that no longer exists.
		expect(bindConnectionToFreeVariable('con <- dbConnect(x)\ndbExecute(con, "SET tz")\n', ['con']).code)
			.toMatchInlineSnapshot(`
			"con_2 <- dbConnect(x)
			dbExecute(con_2, "SET tz")
			"
		`);
	});

	it('leaves a name that merely starts with the taken one alone', () => {
		expect(bindConnectionToFreeVariable('conn = connect(connection_string)\n', ['conn']).code)
			.toBe('conn_2 = connect(connection_string)\n');
	});

	it('changes nothing when there is no assignment to rename', () => {
		expect(bindConnectionToFreeVariable('DBI::dbConnect(x)\n', ['con']))
			.toEqual({ code: 'DBI::dbConnect(x)\n', variableName: undefined });
	});
});
