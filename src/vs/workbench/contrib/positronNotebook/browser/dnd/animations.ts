/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

/**
 * Calculate transforms for a vertical sortable list.
 * When an item is dragged over position X, items at and after X shift down.
 */
export function calculateSortingTransforms(
	items: string[],
	rects: Map<string, DOMRect>,
	activeId: string | null,
	overId: string | null
): Map<string, ItemTransform> {
	const transforms = new Map<string, ItemTransform>();

	if (!activeId || !overId || activeId === overId) {
		return transforms;
	}

	const activeIndex = items.indexOf(activeId);
	const overIndex = items.indexOf(overId);

	if (activeIndex === -1 || overIndex === -1) {
		return transforms;
	}

	const activeRect = rects.get(activeId);
	if (!activeRect) {
		return transforms;
	}

	// Calculate the height of the active item (what we're making room for)
	const activeHeight = activeRect.height;

	// Determine which items need to shift
	// If dragging down (activeIndex < overIndex): items between active and over shift up
	// If dragging up (activeIndex > overIndex): items between over and active shift down
	const isDraggingDown = activeIndex < overIndex;

	for (let i = 0; i < items.length; i++) {
		const id = items[i];

		// Skip the active item (it follows the cursor via DragOverlay)
		if (id === activeId) {
			continue;
		}

		let shouldShift = false;
		let shiftDirection = 0;

		if (isDraggingDown) {
			// Dragging down: items between active+1 and over (inclusive) shift up
			if (i > activeIndex && i <= overIndex) {
				shouldShift = true;
				shiftDirection = -1; // Shift up
			}
		} else {
			// Dragging up: items between over and active-1 (inclusive) shift down
			if (i >= overIndex && i < activeIndex) {
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
