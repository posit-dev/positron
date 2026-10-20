/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isReorderOnlyList, reorderRows } from '../../common/positronReorderOnlyList.js';

const allowed = ['julia', 'python', 'r'];
const values = (rows: { value: string }[]) => rows.map(row => row.value);

describe('isReorderOnlyList', () => {
	it('is true only for the language order', () => {
		expect(isReorderOnlyList('interpreters.languageOrder')).toBe(true);
		expect(isReorderOnlyList('git.branchProtection')).toBe(false);
	});
});

describe('reorderRows', () => {
	it('shows every allowed value, in allowed order, when nothing is saved', () => {
		expect(values(reorderRows(allowed, undefined, allowed, []))).toEqual(['julia', 'python', 'r']);
	});

	it('keeps the saved order and appends new values in allowed order', () => {
		expect(values(reorderRows(allowed, undefined, allowed, ['r']))).toEqual(['r', 'julia', 'python']);
	});

	it('returns the saved value when the setting has no allowed values', () => {
		expect(values(reorderRows(undefined, undefined, [], ['r']))).toEqual(['r']);
	});

	it('labels each value from the label at its allowed index', () => {
		expect(reorderRows(allowed, ['Julia', 'Python', 'R'], allowed, ['r'])).toEqual([
			{ value: 'r', label: 'R' },
			{ value: 'julia', label: 'Julia' },
			{ value: 'python', label: 'Python' },
		]);
	});

	it('leaves out an allowed value that is not a default unless this scope saved it', () => {
		const labels = ['Julia (not installed)', 'Python', 'R'];
		expect(values(reorderRows(allowed, labels, ['python', 'r'], ['r']))).toEqual(['r', 'python']);
		expect(reorderRows(allowed, labels, ['python', 'r'], ['julia'])[0]).toEqual({ value: 'julia', label: 'Julia (not installed)' });
	});

	it('keeps a saved value that is not allowed, labeled by itself', () => {
		expect(reorderRows(['python'], ['Python'], ['python'], ['ark'])).toEqual([
			{ value: 'ark', label: 'ark' },
			{ value: 'python', label: 'Python' },
		]);
	});
});
