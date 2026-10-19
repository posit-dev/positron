/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isReorderOnlyList, reorderRows, withMissingValues } from '../../common/positronReorderOnlyList.js';

const KEY = 'interpreters.languageOrder';
const allowed = ['julia', 'python', 'r'];

describe('withMissingValues', () => {
	it('shows every allowed value, in allowed order, when nothing is saved', () => {
		expect(withMissingValues(KEY, allowed, [])).toEqual(['julia', 'python', 'r']);
	});

	it('keeps the saved order and appends new values in allowed order', () => {
		expect(withMissingValues(KEY, allowed, ['r'])).toEqual(['r', 'julia', 'python']);
	});

	it('keeps a saved value that is no longer allowed', () => {
		expect(withMissingValues(KEY, ['python'], ['ark', 'python'])).toEqual(['ark', 'python']);
	});

	it('leaves other settings alone', () => {
		expect(withMissingValues('git.branchProtection', allowed, ['a'])).toEqual(['a']);
	});

	it('returns the saved value when the setting has no allowed values', () => {
		expect(withMissingValues(KEY, undefined, ['r'])).toEqual(['r']);
	});
});

describe('isReorderOnlyList', () => {
	it('is true only for the language order', () => {
		expect(isReorderOnlyList(KEY)).toBe(true);
		expect(isReorderOnlyList('git.branchProtection')).toBe(false);
	});
});

describe('reorderRows', () => {
	it('labels each value from the label at its allowed index', () => {
		expect(reorderRows(KEY, allowed, ['Julia', 'Python', 'R'], ['r'])).toEqual([
			{ value: 'r', label: 'R' },
			{ value: 'julia', label: 'Julia' },
			{ value: 'python', label: 'Python' },
		]);
	});

	it('labels a saved value that is not allowed by itself', () => {
		expect(reorderRows(KEY, ['python'], ['Python'], ['ark'])).toEqual([
			{ value: 'ark', label: 'ark' },
			{ value: 'python', label: 'Python' },
		]);
	});

	it('labels values by themselves when there are no labels', () => {
		expect(reorderRows(KEY, ['python'], undefined, [])).toEqual([{ value: 'python', label: 'python' }]);
	});
});
