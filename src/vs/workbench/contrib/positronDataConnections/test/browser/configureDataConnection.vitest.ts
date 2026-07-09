/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getFileDialogFilters } from '../../browser/dialogs/configureDataConnection.js';

describe('getFileDialogFilters', () => {
	it('lists the declared filters first, then All Files', () => {
		expect(getFileDialogFilters([
			{ name: 'DuckDB Files', extensions: ['duckdb', 'ddb'] },
		])).toMatchInlineSnapshot(`
			[
			  {
			    "extensions": [
			      "duckdb",
			      "ddb",
			    ],
			    "name": "DuckDB Files",
			  },
			  {
			    "extensions": [
			      "*",
			    ],
			    "name": "All Files",
			  },
			]
		`);
	});

	it('offers only All Files when the parameter declares no filters', () => {
		expect(getFileDialogFilters(undefined)).toMatchInlineSnapshot(`
			[
			  {
			    "extensions": [
			      "*",
			    ],
			    "name": "All Files",
			  },
			]
		`);
	});
});
