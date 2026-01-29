/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DroppableEntry } from './types.js';

/**
 * Detects which gap the cursor is in for a vertical sortable list.
 * Returns the insertion index (0 = before first item, n = after last item).
 *
 * This function determines where a dragged item should be inserted based on
 * cursor position relative to item midpoints, rather than which item is closest.
 *
 * IMPORTANT: The active cell is included in detection because it still occupies
 * DOM space during drag (opacity: 0 but in layout). This prevents "dead zones"
 * where the cursor is in the active cell's space but no gap opens.
 *
 * @param cursorY - The Y position of the cursor
 * @param items - Ordered array of item IDs
 * @param rects - Map of item ID to their current DOMRect
 * @param activeId - The ID of the currently dragged item
 * @returns The insertion index where the item should be placed
 */
export function detectInsertionIndex(
	cursorY: number,
	items: string[],
	rects: Map<string, DOMRect>,
	activeId: string | null
): number {
	const activeIndex = activeId ? items.indexOf(activeId) : -1;

	// Build list of ALL items with their midpoints (including active)
	const itemsWithMidpoints: Array<{ index: number; midY: number; isActive: boolean }> = [];

	for (let i = 0; i < items.length; i++) {
		const rect = rects.get(items[i]);
		if (!rect) {
			continue;
		}

		itemsWithMidpoints.push({
			index: i,
			midY: rect.top + rect.height / 2,
			isActive: items[i] === activeId,
		});
	}

	// If no items to compare against, insert at position 0
	if (itemsWithMidpoints.length === 0) {
		return 0;
	}

	// Sort by visual Y position (handles any FLIP transforms)
	itemsWithMidpoints.sort((a, b) => a.midY - b.midY);

	// Find insertion point
	for (const { index, midY, isActive } of itemsWithMidpoints) {
		if (cursorY < midY) {
			// Cursor is above this item's midpoint
			if (isActive) {
				// Cursor above active item = same position (no move)
				return activeIndex;
			}
			// Cursor above non-active item = insert before it
			return index;
		}
	}

	// Cursor is below all items, insert at end
	return items.length;
}

/**
 * Find the droppable closest to the given point using center-to-center distance.
 * This is the same algorithm as dnd-kit's closestCenter.
 */
export function closestCenter(
	point: { x: number; y: number },
	droppables: DroppableEntry[],
	activeId: string | null
): DroppableEntry | null {
	let closest: DroppableEntry | null = null;
	let minDistance = Infinity;

	for (const droppable of droppables) {
		// Skip the currently dragged item
		if (droppable.id === activeId) {
			continue;
		}

		const centerX = droppable.rect.left + droppable.rect.width / 2;
		const centerY = droppable.rect.top + droppable.rect.height / 2;

		const distance = Math.sqrt(
			Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)
		);

		if (distance < minDistance) {
			minDistance = distance;
			closest = droppable;
		}
	}

	return closest;
}
