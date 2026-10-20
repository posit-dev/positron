/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { updateLanguageOrderSchema } from '../../../../services/languageRuntime/common/languageOrderConfiguration.js';
import { isReorderOnlyList, reorderListError, reorderRows } from '../../common/positronReorderOnlyList.js';

const allowed = ['julia', 'python', 'r'];
const values = (rows: { value: string }[]) => rows.map(row => row.value);

describe('isReorderOnlyList', () => {
	it('is true only for the language order', () => {
		expect(isReorderOnlyList('interpreters.languageOrder')).toBe(true);
		expect(isReorderOnlyList('git.branchProtection')).toBe(false);
	});
});

describe('reorderRows', () => {
	it('shows every default, in order, when nothing is saved', () => {
		expect(values(reorderRows({ allowed, labels: [], defaults: allowed }, []))).toEqual(['julia', 'python', 'r']);
	});

	it('keeps the saved order and appends missing defaults', () => {
		expect(values(reorderRows({ allowed, labels: [], defaults: ['python', 'r'] }, ['r']))).toEqual(['r', 'python']);
	});

	it('labels each value from the label at its allowed index', () => {
		expect(reorderRows({ allowed, labels: ['Julia', 'Python', 'R'], defaults: allowed }, ['r'])).toEqual([
			{ value: 'r', label: 'R' },
			{ value: 'julia', label: 'Julia' },
			{ value: 'python', label: 'Python' },
		]);
	});

	it('leaves out an allowed value that is not a default unless this scope saved it', () => {
		const labels = ['Julia (not installed)', 'Python', 'R'];
		expect(values(reorderRows({ allowed, labels, defaults: ['python', 'r'] }, ['r']))).toEqual(['r', 'python']);
		expect(reorderRows({ allowed, labels, defaults: ['python', 'r'] }, ['julia'])[0]).toEqual({ value: 'julia', label: 'Julia (not installed)' });
	});

	it('shows a hand-edited duplicate once and drops non-strings, so a reorder saves a clean value', () => {
		expect(values(reorderRows({ allowed, labels: [], defaults: ['python', 'r'] }, ['r', 3, 'python', 'r']))).toEqual(['r', 'python']);
	});

	it('keeps a saved value that is not allowed, labeled by itself', () => {
		expect(reorderRows({ allowed: ['python'], labels: ['Python'], defaults: ['python'] }, ['ark'])).toEqual([
			{ value: 'ark', label: 'ark' },
			{ value: 'python', label: 'Python' },
		]);
	});
});

describe('reorderListError', () => {
	beforeEach(() => updateLanguageOrderSchema([{ languageId: 'python', languageName: 'Python' }, { languageId: 'r', languageName: 'R' }], []));

	it('flags a saved value with duplicates, like other list settings', () => {
		expect(reorderListError('interpreters.languageOrder', ['r', 'python', 'r'])).toContain('Array has duplicate items');
	});

	it('accepts a valid saved value', () => {
		expect(reorderListError('interpreters.languageOrder', ['r', 'python'])).toBeNull();
	});
});
