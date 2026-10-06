/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';

/**
 * `fileSize.ts` exists once per data driver that lists files, because each extension compiles under
 * its own tsconfig and cannot import from another. The copies have to stay in step, or the same
 * file's size would read differently in the Databricks and Snowflake trees.
 *
 * Only the Databricks copy has behavioral tests, in its extension's driver tests. This guard is what
 * lets those tests speak for both.
 */
const DATABRICKS = 'positron-data-driver-databricks/src/fileSize.ts';
const SNOWFLAKE = 'positron-data-driver-snowflake/src/fileSize.ts';

// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started from.
function read(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('fileSize copies', () => {
	it('keeps the Snowflake copy in step with the Databricks copy', () => {
		expect(read(SNOWFLAKE)).toBe(read(DATABRICKS));
	});
});
