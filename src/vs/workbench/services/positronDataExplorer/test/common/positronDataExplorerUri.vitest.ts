/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { PositronDataExplorerUri } from '../../common/positronDataExplorerUri.js';

describe('PositronDataExplorerUri', () => {
	it('round-trips runtime comm ids and scheme-prefixed backend identifiers', () => {
		const identifiers = [
			'12345678-1234-1234-1234-123456789abc', // runtime comm UUID
			'duckdb:file:///path/to/data.csv',       // file backend
			'sqlite:sqlite-13:table:flights',        // data connection driver backend
		];
		const roundTripped = identifiers.map(id =>
			PositronDataExplorerUri.parse(PositronDataExplorerUri.generate(id)));
		expect(roundTripped).toEqual(identifiers);
	});

	it('returns undefined for a non-matching resource', () => {
		expect(PositronDataExplorerUri.parse(URI.parse('file:///not/a/data/explorer'))).toBeUndefined();
	});
});
