/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { PositronObjectExplorerUri } from '../../common/positronObjectExplorerUri.js';

describe('PositronObjectExplorerUri', () => {
	it('round-trips a comm id', () => {
		const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
		const uri = URI.parse(PositronObjectExplorerUri.generate(id).toString());

		expect(PositronObjectExplorerUri.parse(uri)).toBe(id);
		expect(PositronObjectExplorerUri.backingUri(uri)).toBeUndefined();
	});

	it('round-trips a file identifier and recovers the file', () => {
		const file = URI.file('/path/to/data file.json');
		const uri = URI.parse(PositronObjectExplorerUri.generate(`json:${file.toString()}`).toString());

		expect(PositronObjectExplorerUri.parse(uri)).toBe(`json:${file.toString()}`);
		expect(PositronObjectExplorerUri.backingUri(uri)?.toString()).toBe(file.toString());
	});

	it('rejects other schemes and malformed identifiers', () => {
		expect(PositronObjectExplorerUri.parse(URI.file('/x.json'))).toBeUndefined();
		expect(PositronObjectExplorerUri.parse(URI.from({ scheme: 'positron-object-explorer', path: 'nope' }))).toBeUndefined();
	});
});
