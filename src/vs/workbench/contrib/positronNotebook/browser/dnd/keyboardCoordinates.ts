/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardCoordinateGetter } from './types.js';

/**
 * Default keyboard coordinate getter for vertical sortable lists.
 * Maps arrow keys to movement between droppable items.
 */
export const sortableKeyboardCoordinates: KeyboardCoordinateGetter = (
	event,
	{ currentCoordinates, context }
) => {
	const { droppableRects, activeId } = context;

	if (!activeId) {
		return undefined;
	}

	// Get sorted list of droppables by vertical position
	const sortedDroppables = Array.from(droppableRects.entries())
		.filter(([id]) => id !== activeId)
		.sort(([, a], [, b]) => a.top - b.top);

	if (sortedDroppables.length === 0) {
		return undefined;
	}

	// Find current position in the sorted list based on coordinates
	const currentY = currentCoordinates.y;
	let currentIndex = sortedDroppables.findIndex(([, rect]) => {
		const centerY = rect.top + rect.height / 2;
		return currentY < centerY;
	});

	if (currentIndex === -1) {
		currentIndex = sortedDroppables.length;
	}

	let targetIndex = currentIndex;

	switch (event.key) {
		case 'ArrowUp':
			targetIndex = Math.max(0, currentIndex - 1);
			break;
		case 'ArrowDown':
			// Move down one position, clamped to the last valid index
			targetIndex = Math.min(sortedDroppables.length - 1, currentIndex + 1);
			break;
		default:
			return undefined;
	}

	// Ensure we're within bounds (defensive)
	targetIndex = Math.max(0, Math.min(targetIndex, sortedDroppables.length - 1));

	const targetDroppable = sortedDroppables[targetIndex];
	if (!targetDroppable) {
		return undefined;
	}

	const [, targetRect] = targetDroppable;
	return {
		x: targetRect.left + targetRect.width / 2,
		y: targetRect.top + targetRect.height / 2,
	};
};
