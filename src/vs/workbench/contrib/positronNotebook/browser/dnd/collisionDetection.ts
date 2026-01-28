/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DroppableEntry } from './types.js';

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
