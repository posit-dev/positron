/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';

/**
 * `databasePath.ts` exists once per file-database driver, because each extension compiles under
 * its own tsconfig and cannot import from another extension. The copies have to stay in step:
 * fixing how one driver resolves or checks a database path and forgetting the other would leave the
 * two saving different paths for the same input.
 *
 * Only the SQLite copy has behavioral tests, in `databasePath.vitest.ts`. This guard is what lets
 * those tests speak for both.
 */
describe('databasePath copies', () => {
	// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started from.
	function read(relativePath: string): string {
		return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
	}

	it('keeps the DuckDB copy in step with the SQLite copy', () => {
		expect(read('positron-data-driver-duckdb/src/databasePath.ts')).toBe(read('positron-data-driver-sqlite/src/databasePath.ts'));
	});
});
