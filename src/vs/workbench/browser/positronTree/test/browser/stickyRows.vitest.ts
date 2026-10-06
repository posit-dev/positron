/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeRowStructure, computeStickyRows } from '../../classes/stickyRows.js';

const H = 10;

/**
 * Builds rows from depths; a row is expanded when the next row is deeper.
 */
function rows(...depths: number[]) {
	return depths.map((depth, i) => ({
		depth,
		expandState: (depths[i + 1] ?? -1) > depth ? 'expanded' as const : 'leaf' as const
	}));
}

/**
 * Summarizes the band as rowIndex@top pairs.
 */
function band(depths: number[], scrollTop: number, maxRows = 5, rowTop = (i: number) => i * H) {
	const visible = rows(...depths);
	return computeStickyRows(visible, computeRowStructure(visible), rowTop, scrollTop, H, maxRows).map(row => `${row.rowIndex}@${row.top}`);
}

describe('computeStickyRows', () => {
	// root(0) > a(1) > a1..a5 (2), then b(1) > b1..b5 (2)
	const tree = [0, 1, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2];

	it('is empty when nothing has scrolled past', () => {
		expect(band(tree, 0)).toEqual([]);
	});

	it('sticks the root once it scrolls under the band', () => {
		expect(band([0, 1, 1, 1, 1, 1], 5)).toEqual(['0@0']);
	});

	it('stacks the ancestors of the rows inside a nested subtree', () => {
		expect(band(tree, 25)).toEqual(['0@0', '1@10']);
	});

	it('pushes the last row up as its subtree ends, then replaces it', () => {
		// a's subtree ends at y = 70; the band's second slot ends at scrollTop + 20.
		expect(band(tree, 50)).toEqual(['0@0', '1@10']);
		expect(band(tree, 52)).toEqual(['0@0', '1@8']);
		expect(band(tree, 55)).toEqual(['0@0', '1@5']);
		expect(band(tree, 60)).toEqual(['0@0']);
		expect(band(tree, 65)).toEqual(['0@0', '7@10']);
	});

	it('pushes the root out as the tree ends', () => {
		expect(band(tree, 125)).toEqual(['0@-5']);
	});

	it('accounts for a taller row', () => {
		// a1 (row 2) is 50 tall, so a's subtree ends at y = 110.
		const rowTop = (i: number) => i * H + (i > 2 ? 40 : 0);
		expect(band(tree, 85, 5, rowTop)).toEqual(['0@0', '1@10']);
		expect(band(tree, 95, 5, rowTop)).toEqual(['0@0', '1@5']);
	});

	it('limits the band to the maximum number of rows', () => {
		expect(band([0, 1, 2, 3, 4, 4, 4, 4, 4], 45, 2)).toEqual(['0@0', '1@10']);
	});
});
