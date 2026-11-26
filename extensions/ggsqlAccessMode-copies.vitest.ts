/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/**
 * `ggsqlAccessMode.ts` exists in the DuckDB driver, which decides whether to add
 * `?access_mode=read_only` to a ggsql `@connect` line, and in positron-sql, which explains a lock
 * conflict when that line fails. Each extension compiles under its own tsconfig and cannot import
 * from the other. The copies have to agree: if they drifted, positron-sql would tell users to update
 * ggsql when the driver had already added the suffix, or the reverse.
 *
 * Only the DuckDB driver's copy has behavioral tests, in `ggsqlAccessMode.vitest.ts`. This guard is
 * what lets those tests speak for both.
 */
const DUCKDB = 'positron-data-driver-duckdb/src/ggsqlAccessMode.ts';
const SQL = 'positron-sql/src/ggsqlAccessMode.ts';

// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started from.
function read(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('ggsqlAccessMode copies', () => {
	it('keeps the positron-sql copy in step with the DuckDB driver copy', () => {
		expect(read(SQL)).toBe(read(DUCKDB));
	});
});
