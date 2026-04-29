/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { canMoveDown, canMoveUp } from '../../browser/notebookCells/cellContextKeysLogic.js';

describe('canMoveUp', () => {
	it('is false in a single-cell notebook (nothing to move past)', () => {
		expect(canMoveUp(0, 1)).toBe(false);
	});

	it('is false at the first cell of a multi-cell notebook', () => {
		expect(canMoveUp(0, 5)).toBe(false);
	});

	it('is true at any non-first cell of a multi-cell notebook', () => {
		expect(canMoveUp(1, 5)).toBe(true);
		expect(canMoveUp(2, 5)).toBe(true);
		expect(canMoveUp(4, 5)).toBe(true);
	});
});

describe('canMoveDown', () => {
	it('is false in a single-cell notebook (nothing to move past)', () => {
		expect(canMoveDown(0, 1)).toBe(false);
	});

	it('is false at the last cell of a multi-cell notebook', () => {
		expect(canMoveDown(4, 5)).toBe(false);
	});

	it('is true at any non-last cell of a multi-cell notebook', () => {
		expect(canMoveDown(0, 5)).toBe(true);
		expect(canMoveDown(1, 5)).toBe(true);
		expect(canMoveDown(3, 5)).toBe(true);
	});
});
