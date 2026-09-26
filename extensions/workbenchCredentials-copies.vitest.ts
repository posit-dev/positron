/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';

/**
 * `workbenchCredentials.ts` exists once per data connection driver that offers Workbench managed
 * credentials, because each extension compiles under its own tsconfig and cannot import from
 * another. The copies have to stay in step: fixing the Workbench detection or the credential lookup
 * in one and forgetting the other would leave one driver offering a mechanism that cannot connect.
 */
const COPIES = [
	'positron-data-driver-snowflake/src/workbenchCredentials.ts',
	'positron-data-driver-databricks/src/workbenchCredentials.ts',
] as const;

// `__dirname` is this file's own directory, so the paths hold wherever Vitest is started from.
function read(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('workbenchCredentials copies', () => {
	it('keeps the Databricks copy identical to the Snowflake copy', () => {
		const [snowflake, databricks] = COPIES;
		expect(read(databricks)).toBe(read(snowflake));
	});
});
