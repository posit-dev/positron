/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// eslint-disable-next-line local/code-import-patterns -- pure-function test for SortableCellList helpers; mirrors the dnd-kit type import in sortableCellListLogic.ts.
import type { ClientRect } from '@dnd-kit/core';
import { assertDefined } from '../../../../../base/common/types.js';
import { computeDropIndex, resolveDraggedCells } from '../../browser/notebookCells/sortableCellListLogic.js';

interface TestCell {
	readonly handle: number;
	readonly index: number;
}

/** Build N cells where handle and index both equal the position. */
function makeCells(n: number): TestCell[] {
	return Array.from({ length: n }, (_, i) => ({ handle: i, index: i }));
}

/** Lay cells out vertically, each `height` tall, starting at y = 0. */
function makeRects(cells: readonly TestCell[], height: number): Map<number, ClientRect> {
	const rects = new Map<number, ClientRect>();
	cells.forEach((cell, i) => {
		rects.set(cell.handle, {
			top: i * height,
			left: 0,
			right: 100,
			bottom: i * height + height,
			width: 100,
			height,
		});
	});
	return rects;
}

function makeContainers(cells: readonly TestCell[]): { id: number }[] {
	return cells.map(c => ({ id: c.handle }));
}

describe('computeDropIndex', () => {
	const HEIGHT = 100;
	const cells = makeCells(3);
	const rects = makeRects(cells, HEIGHT);
	const containers = makeContainers(cells);

	it('pointer in top half of a cell targets the gap above (dropIndex = cell index)', () => {
		// Pointer at y=110 falls inside cell 1 (y=100-200), top half.
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 110 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[0]],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve a candidate');
		expect(result.closestId).toBe(1);
		expect(result.dropIndex).toBe(1);
	});

	it('pointer in bottom half of a cell targets the gap below (dropIndex = cell index + 1)', () => {
		// Pointer at y=180 is in cell 1's bottom half (mid = 150).
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 180 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[0]],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve a candidate');
		expect(result.closestId).toBe(1);
		expect(result.dropIndex).toBe(2);
	});

	it('pointer above all cells snaps to the nearest cell (the first)', () => {
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: -50 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[2]],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve a candidate');
		expect(result.closestId).toBe(0);
		expect(result.dropIndex).toBe(0);
	});

	it('pointer below all cells snaps to the nearest cell (the last)', () => {
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 500 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[0]],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve a candidate');
		expect(result.closestId).toBe(2);
		expect(result.dropIndex).toBe(3);
	});

	it('cells in the active drag set are excluded from candidates', () => {
		// Pointer at y=150 is midline of cell 1 -- excluding it forces the
		// match onto cell 0 or cell 2 (equidistant). The loop keeps the first
		// equally-close match, so closestId is cell 0.
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 150 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[1]],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve a candidate');
		expect(result.closestId).toBe(0);
	});

	it('containers without a measurable rect are skipped, falling back to the next nearest', () => {
		// Only cell 2's rect is present. Even with a pointer at y=110 (which
		// would normally pick cell 1), the missing rects force a fall-through
		// to cell 2 -- the only candidate the loop can measure.
		const partialRects = new Map<number, ClientRect>();
		partialRects.set(2, rects.get(2)!);

		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 110 },
			droppableContainers: containers,
			droppableRects: partialRects,
			activeCells: [],
			allCells: cells,
		});

		assertDefined(result, 'computeDropIndex should resolve the lone measurable cell');
		expect(result.closestId).toBe(2);
	});

	it('isNoOp is true when the drop index would leave the dragged cell in place', () => {
		// Single cell at index 1 dragged. Drop at the gap above (index 1) or
		// below (index 2) is a no-op -- the cell would land on itself.
		const aboveSelf = computeDropIndex({
			pointerCoordinates: { x: 50, y: 110 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[1]],
			allCells: cells,
		});
		assertDefined(aboveSelf, 'computeDropIndex should resolve a candidate');
		expect(aboveSelf.isNoOp).toBe(true);

		const elsewhere = computeDropIndex({
			pointerCoordinates: { x: 50, y: 10 },
			droppableContainers: containers,
			droppableRects: rects,
			activeCells: [cells[1]],
			allCells: cells,
		});
		assertDefined(elsewhere, 'computeDropIndex should resolve a candidate');
		expect(elsewhere.isNoOp).toBe(false);
	});

	it('returns null when no candidates have measurable rects', () => {
		const result = computeDropIndex({
			pointerCoordinates: { x: 50, y: 50 },
			droppableContainers: containers,
			droppableRects: new Map(),
			activeCells: [],
			allCells: cells,
		});

		expect(result).toBeNull();
	});
});

describe('resolveDraggedCells', () => {
	it('returns the sorted multi-selection when the dragged cell is part of it', () => {
		const cells = makeCells(5);
		// Selection given out of order to verify the helper sorts by index.
		const selection = [cells[3], cells[1], cells[2]];

		const result = resolveDraggedCells(cells[2], selection);

		expect(result).toEqual([cells[1], cells[2], cells[3]]);
	});

	it('drags only the grabbed cell when it is NOT part of the multi-selection', () => {
		const cells = makeCells(5);
		// Cells 1 and 2 are selected; user grabs cell 0 (unselected).
		const selection = [cells[1], cells[2]];

		const result = resolveDraggedCells(cells[0], selection);

		expect(result).toEqual([cells[0]]);
	});

	it('drags only the grabbed cell when only one cell is selected (no multi-drag with 1 cell)', () => {
		const cells = makeCells(3);
		const selection = [cells[1]]; // single-cell "selection"

		const result = resolveDraggedCells(cells[1], selection);

		expect(result).toEqual([cells[1]]);
	});

	it('drags only the grabbed cell when nothing is selected', () => {
		const cells = makeCells(3);

		const result = resolveDraggedCells(cells[1], []);

		expect(result).toEqual([cells[1]]);
	});
});
