/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns -- pure helpers split out of SortableCellList.tsx; the .tsx file imports @dnd-kit/core directly without flagging because the import-patterns rule is scoped to *.ts. We need the same dnd-kit types here.
import type { ClientRect, UniqueIdentifier } from '@dnd-kit/core';

/**
 * Pure helpers for {@link SortableCellList}'s drag-and-drop logic. Kept free of
 * React, dnd-kit lifecycle, and DOM side effects so they can be exercised by
 * unit tests without standing up a real drag.
 *
 * Both helpers accept the minimal `{ handle, index }` shape rather than the
 * full `IPositronNotebookCell` -- that's all the logic reads, and narrowing
 * makes test fixtures trivial.
 */
interface CellRef {
	readonly handle: number;
	readonly index: number;
}

/**
 * Computes the drop indicator index (where the dragged cells will land) given
 * the current pointer position. Returns `null` when no candidate cell can be
 * found at all -- the caller falls back to dnd-kit's built-in collision
 * detection.
 *
 * When a closest cell is found but cannot be resolved to an index in
 * `allCells` (transient state during cell removal: a droppable is registered
 * for a cell that's mid-unmount), the helper returns `{ closestId, dropIndex:
 * null, isNoOp: false }`. The caller then surfaces `closestId` to dnd-kit so
 * the over container stays tracked, but skips the indicator state update.
 *
 * The drop index splits each cell into top and bottom halves: a pointer in the
 * top half targets the gap *above* that cell (`overCellIndex`); a pointer in
 * the bottom half targets the gap *below* (`overCellIndex + 1`). Cells in the
 * active drag set are excluded from the candidate pool -- dropping onto a cell
 * that is itself being dragged should not count as a target.
 *
 * `isNoOp` flags target positions that would leave the dragged cells in place
 * (any index from the first dragged index through `lastDraggedIndex + 1`); the
 * caller uses it to draw a disabled-style indicator.
 */
export function computeDropIndex(args: {
	pointerCoordinates: { x: number; y: number };
	droppableContainers: readonly { id: UniqueIdentifier }[];
	droppableRects: Map<UniqueIdentifier, ClientRect>;
	activeCells: readonly CellRef[];
	allCells: readonly CellRef[];
}): { closestId: UniqueIdentifier; dropIndex: number | null; isNoOp: boolean } | null {
	const { pointerCoordinates, droppableContainers, droppableRects, activeCells, allCells } = args;

	// Exclude active item and secondary drag participants -- dropping onto
	// the cell being dragged shouldn't count as a target.
	const excludeHandles = new Set(activeCells.map(c => c.handle));
	const candidates = droppableContainers.filter(c => !excludeHandles.has(c.id as number));

	// Find the cell the pointer is inside (distance 0) or nearest to.
	let closestId: UniqueIdentifier | null = null;
	let closestRect: ClientRect | null = null;
	let closestDist = Infinity;

	for (const container of candidates) {
		const rect = droppableRects.get(container.id);
		if (!rect) { continue; }

		const top = rect.top;
		const bottom = rect.top + rect.height;
		let dist: number;

		if (pointerCoordinates.y < top) {
			dist = top - pointerCoordinates.y;
		} else if (pointerCoordinates.y > bottom) {
			dist = pointerCoordinates.y - bottom;
		} else {
			dist = 0;
		}

		if (dist < closestDist) {
			closestDist = dist;
			closestId = container.id;
			closestRect = rect;
		}
	}

	if (closestId === null || closestRect === null) {
		return null;
	}

	const overCellIndex = allCells.findIndex(c => c.handle === closestId);
	if (overCellIndex === -1) {
		return { closestId, dropIndex: null, isNoOp: false };
	}

	const midY = closestRect.top + closestRect.height / 2;
	const dropIndex = pointerCoordinates.y < midY
		? overCellIndex       // top half: gap ABOVE the cell
		: overCellIndex + 1;  // bottom half: gap BELOW the cell

	// Detect no-op positions: dropping the cell back where it started. Any
	// target from the first dragged index through lastDraggedIndex + 1
	// produces no movement.
	const minIdx = activeCells.length > 0 ? activeCells[0].index : -1;
	const maxIdx = activeCells.length > 0 ? activeCells[activeCells.length - 1].index : -1;
	const isNoOp = dropIndex >= minIdx && dropIndex <= maxIdx + 1;

	return { closestId, dropIndex, isNoOp };
}

/**
 * Decides which cells participate in a drag based on whether the user grabbed
 * a cell that is part of an existing multi-selection. Multi-drag activates
 * only when (a) more than one cell is selected and (b) the grabbed cell is
 * one of them -- grabbing an unselected cell ignores the selection and drags
 * just that cell.
 */
export function resolveDraggedCells<T extends CellRef>(
	draggedCell: T,
	selectedCells: readonly T[]
): T[] {
	// Only use multi-drag if (1) more than one cell is selected and (2) the
	// dragged cell is part of the selection. Compare by handle rather than
	// reference so re-rendered cell instances still match.
	const isDraggedCellSelected = selectedCells.some(c => c.handle === draggedCell.handle);
	if (selectedCells.length > 1 && isDraggedCellSelected) {
		// Sort by index to preserve relative cell order in the drag set.
		return [...selectedCells].sort((a, b) => a.index - b.index);
	}
	// Single-cell drag: either no multi-selection or dragging an unselected cell.
	return [draggedCell];
}
