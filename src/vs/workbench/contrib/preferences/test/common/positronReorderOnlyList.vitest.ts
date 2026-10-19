/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isReorderOnlyList, withMissingValues } from '../../common/positronReorderOnlyList.js';

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
		expect(isReorderOnlyList('git.branchProtection')).toBe(false);
		expect(isReorderOnlyList(KEY)).toBe(true);
	});

	it('returns the saved value when the setting has no allowed values', () => {
		expect(withMissingValues(KEY, undefined, ['r'])).toEqual(['r']);
	});
});
