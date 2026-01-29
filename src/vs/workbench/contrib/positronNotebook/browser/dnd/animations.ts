/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

/**
 * Calculate transforms for a vertical sortable list based on insertion index.
 *
 * The insertionIndex represents where the dragged item will be inserted:
 * - 0 means before the first item
 * - n means after the last item (where n is items.length)
 *
 * Items shift to make room for the dragged item at the insertion point:
 * - If dragging down (insertionIndex > activeIndex): items between shift UP
 * - If dragging up (insertionIndex <= activeIndex): items between shift DOWN
 */
export function calculateSortingTransforms(
	items: string[],
	rects: Map<string, DOMRect>,
	activeId: string | null,
	insertionIndex: number | null
): Map<string, ItemTransform> {
	const transforms = new Map<string, ItemTransform>();

	if (!activeId || insertionIndex === null) {
		return transforms;
	}

	const activeIndex = items.indexOf(activeId);

	if (activeIndex === -1) {
		return transforms;
	}

	// No shift needed if inserting at current position or position after current
	// (since removing the item and inserting at activeIndex+1 results in same position)
	if (insertionIndex === activeIndex || insertionIndex === activeIndex + 1) {
		return transforms;
	}

	const activeRect = rects.get(activeId);
	if (!activeRect) {
		return transforms;
	}

	// Calculate the height of the active item (what we're making room for)
	const activeHeight = activeRect.height;

	// Determine which items need to shift based on insertion index
	// If dragging down (insertionIndex > activeIndex): items between shift up
	// If dragging up (insertionIndex < activeIndex): items between shift down
	const isDraggingDown = insertionIndex > activeIndex;

	for (let i = 0; i < items.length; i++) {
		const id = items[i];

		// Skip the active item (it follows the cursor via DragOverlay)
		if (id === activeId) {
			continue;
		}

		let shouldShift = false;
		let shiftDirection = 0;

		if (isDraggingDown) {
			// Dragging down: items from activeIndex+1 to insertionIndex-1 (inclusive) shift up
			// Example: activeIndex=2, insertionIndex=5
			// Items at indices 3, 4 shift up (insertionIndex-1 because insertion happens BEFORE that index)
			if (i > activeIndex && i < insertionIndex) {
				shouldShift = true;
				shiftDirection = -1; // Shift up
			}
		} else {
			// Dragging up: items from insertionIndex to activeIndex-1 (inclusive) shift down
			// Example: activeIndex=5, insertionIndex=2
			// Items at indices 2, 3, 4 shift down
			if (i >= insertionIndex && i < activeIndex) {
				shouldShift = true;
				shiftDirection = 1; // Shift down
			}
		}

		if (shouldShift) {
			transforms.set(id, {
				x: 0,
				y: shiftDirection * activeHeight,
			});
		}
	}

	return transforms;
}

/**
 * Convert ItemTransform to CSS transform string.
 */
export function transformToString(transform: ItemTransform | null): string | undefined {
	if (!transform) {
		return undefined;
	}

	const parts: string[] = [];

	if (transform.x !== 0 || transform.y !== 0) {
		parts.push(`translate3d(${transform.x}px, ${transform.y}px, 0)`);
	}

	if (transform.scaleX !== undefined && transform.scaleX !== 1) {
		parts.push(`scaleX(${transform.scaleX})`);
	}

	if (transform.scaleY !== undefined && transform.scaleY !== 1) {
		parts.push(`scaleY(${transform.scaleY})`);
	}

	return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Get CSS transition string for smooth animation.
 */
export function getTransition(
	duration: number = 200,
	easing: string = 'ease'
): string {
	return `transform ${duration}ms ${easing}`;
}
