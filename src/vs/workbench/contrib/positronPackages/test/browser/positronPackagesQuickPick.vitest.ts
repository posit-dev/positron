/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { hoistExactMatch } from '../../browser/positronPackagesQuickPick.js';

describe('hoistExactMatch', () => {
	const results = [
		{ name: 'dplyrutils' },
		{ name: 'dplyr' },
		{ name: 'dplyrExtra' },
	];

	it('moves an exact match to the front, preserving the order of the rest', () => {
		expect(hoistExactMatch(results, 'dplyr').map((r) => r.name)).toEqual([
			'dplyr',
			'dplyrutils',
			'dplyrExtra',
		]);
	});

	it('matches case-insensitively and ignores surrounding whitespace', () => {
		expect(hoistExactMatch(results, '  DPLYR  ').map((r) => r.name)).toEqual([
			'dplyr',
			'dplyrutils',
			'dplyrExtra',
		]);
	});

	it('returns results unchanged when there is no exact match', () => {
		expect(hoistExactMatch(results, 'plyr')).toBe(results);
	});

	it('returns results unchanged when the exact match is already first', () => {
		const alreadyFirst = [{ name: 'tibble' }, { name: 'tibbletime' }];
		expect(hoistExactMatch(alreadyFirst, 'tibble')).toBe(alreadyFirst);
	});

	it('handles an empty result set', () => {
		expect(hoistExactMatch([], 'dplyr')).toEqual([]);
	});
});
