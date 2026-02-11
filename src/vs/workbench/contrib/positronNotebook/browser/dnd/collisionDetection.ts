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
 * IMPORTANT: The active cells are included in detection because they still occupy
 * DOM space during drag (opacity: 0 but in layout). This prevents "dead zones"
 * where the cursor is in the active cells' space but no gap opens.
 *
 * For multi-cell drag, ALL active cells are treated as a single contiguous block.
 * When the cursor is within any active cell's midpoint range, we return the
 * first active index to indicate "no movement needed."
 *
 * @param cursorY - The Y position of the cursor
 * @param items - Ordered array of item IDs
 * @param rects - Map of item ID to their current DOMRect
 * @param activeIds - Array of IDs of the currently dragged items
 * @returns The insertion index where the items should be placed
 */
export function detectInsertionIndex(
	cursorY: number,
	items: string[],
	rects: Map<string, DOMRect>,
	activeIds: string[]
): number {
	// Create a Set for O(1) lookup of active IDs
	const activeIdSet = new Set(activeIds);

	// Find the first active index (used as the "home" position for no-move)
	let firstActiveIndex = -1;
	for (let i = 0; i < items.length; i++) {
		if (activeIdSet.has(items[i])) {
			firstActiveIndex = i;
			break;
		}
	}

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
			isActive: activeIdSet.has(items[i]),
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
				// Cursor above any active item = same position (no move)
				return firstActiveIndex;
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
