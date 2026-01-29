/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

/**
 * Calculate the "slot height" for an item - the distance from this item's top
 * to the next item's top. This naturally includes any CSS gap between items.
 * For the last item, returns just the item's height.
 */
function getSlotHeight(itemIndex: number, items: string[], rects: Map<string, DOMRect>): number {
	const rect = rects.get(items[itemIndex]);
	if (!rect) {
		return 0;
	}

	if (itemIndex < items.length - 1) {
		const nextRect = rects.get(items[itemIndex + 1]);
		if (nextRect) {
			return nextRect.top - rect.top;
		}
	}
	return rect.height;
}

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
 *
 * The active (dragged) item also gets a transform to animate to its insertion position.
 *
 * IMPORTANT: This function uses "slot heights" (distance between item tops) rather than
 * raw heights to account for CSS gaps between items. Without this, cells can overlap
 * during drag when a large cell drags over a smaller cell's position.
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

	const activeRect = rects.get(activeId);
	if (!activeRect) {
		return transforms;
	}

	// No shift needed if inserting at current position or position after current
	// (since removing the item and inserting at activeIndex+1 results in same position)
	if (insertionIndex === activeIndex || insertionIndex === activeIndex + 1) {
		return transforms;
	}

	// Calculate the "slot height" for the active item - this is the space it occupies
	// including any gap after it. This is what other items need to shift by.
	const activeSlotHeight = getSlotHeight(activeIndex, items, rects);

	// Determine which items need to shift based on insertion index
	// If dragging down (insertionIndex > activeIndex): items between shift up
	// If dragging up (insertionIndex < activeIndex): items between shift down
	const isDraggingDown = insertionIndex > activeIndex;

	// Calculate the transform for the active (dragged) item to move to its insertion position
	// We need to calculate the cumulative slot heights of items between current and target position
	let activeItemTransformY = 0;

	for (let i = 0; i < items.length; i++) {
		const id = items[i];

		// Handle the active item - calculate where it should move to
		if (id === activeId) {
			continue;
		}

		const itemRect = rects.get(id);
		if (!itemRect) {
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
				// Active item moves down by this item's slot height (height + gap)
				activeItemTransformY += getSlotHeight(i, items, rects);
			}
		} else {
			// Dragging up: items from insertionIndex to activeIndex-1 (inclusive) shift down
			// Example: activeIndex=5, insertionIndex=2
			// Items at indices 2, 3, 4 shift down
			if (i >= insertionIndex && i < activeIndex) {
				shouldShift = true;
				shiftDirection = 1; // Shift down
				// Active item moves up by this item's slot height (height + gap)
				activeItemTransformY -= getSlotHeight(i, items, rects);
			}
		}

		if (shouldShift) {
			transforms.set(id, {
				x: 0,
				y: shiftDirection * activeSlotHeight,
			});
		}
	}

	// Set the transform for the active item to move to its insertion position
	if (activeItemTransformY !== 0) {
		transforms.set(activeId, {
			x: 0,
			y: activeItemTransformY,
		});
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
