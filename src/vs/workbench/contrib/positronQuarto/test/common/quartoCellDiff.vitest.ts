/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { diffCellRuns, ICellRun } from '../../common/quartoCellDiff.js';

describe('diffCellRuns', () => {
	const r = (code: string): ICellRun => ({ language: 'r', code });

	it('reports no work when the cells are unchanged', () => {
		expect(diffCellRuns([r('a'), r('b')], [r('a'), r('b')]))
			.toEqual({ prefix: 2, removeCount: 0, insertCount: 0 });
	});

	it('splices in a chunk inserted in the middle, keeping both sides', () => {
		// The reviewer's case: inserting one chunk must not disturb the others.
		expect(diffCellRuns(
			[r('a'), r('b'), r('c')],
			[r('a'), r('x'), r('b'), r('c')]
		)).toEqual({ prefix: 1, removeCount: 0, insertCount: 1 });
	});

	it('splices out a chunk deleted from the middle', () => {
		expect(diffCellRuns(
			[r('a'), r('b'), r('c')],
			[r('a'), r('c')]
		)).toEqual({ prefix: 1, removeCount: 1, insertCount: 0 });
	});

	it('replaces only the cell whose language changed', () => {
		expect(diffCellRuns(
			[r('a'), r('b')],
			[{ language: 'python', code: 'a' }, r('b')]
		)).toEqual({ prefix: 0, removeCount: 1, insertCount: 1 });
	});

	it('does not confuse chunks that hold identical code', () => {
		// Content is an equality test at a known position, not a lookup key, so
		// duplicates cannot cross-match the way the document model's hash map does.
		expect(diffCellRuns([r('a'), r('a')], [r('a')]))
			.toEqual({ prefix: 1, removeCount: 1, insertCount: 0 });
		expect(diffCellRuns([r('a')], [r('a'), r('a')]))
			.toEqual({ prefix: 1, removeCount: 0, insertCount: 1 });
	});

	it('treats a cell with no text model as matching nothing', () => {
		// A disposed model cannot be reused, so that one cell is replaced rather
		// than the whole document being rebuilt around it.
		expect(diffCellRuns(
			[r('a'), { language: 'r', code: undefined }, r('c')],
			[r('a'), r('b'), r('c')]
		)).toEqual({ prefix: 1, removeCount: 1, insertCount: 1 });
	});

	it('handles the empty document at both ends', () => {
		expect(diffCellRuns([], [r('a')])).toEqual({ prefix: 0, removeCount: 0, insertCount: 1 });
		expect(diffCellRuns([r('a')], [])).toEqual({ prefix: 0, removeCount: 1, insertCount: 0 });
		expect(diffCellRuns([], [])).toEqual({ prefix: 0, removeCount: 0, insertCount: 0 });
	});
});
