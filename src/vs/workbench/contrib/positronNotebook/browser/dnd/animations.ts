/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

/**
 * Infer the CSS gap between items by examining adjacent item rects.
 * Returns 0 if gap cannot be determined (single item or missing rects).
 */
function inferGap(items: string[], rects: Map<string, DOMRect>): number {
	// Find first pair of adjacent items with valid rects
	for (let i = 0; i < items.length - 1; i++) {
		const rect = rects.get(items[i]);
		const nextRect = rects.get(items[i + 1]);
		if (rect && nextRect) {
			// gap = next item's top - current item's bottom
			return nextRect.top - (rect.top + rect.height);
		}
	}
	return 0; // No gap inferrable (single item or missing rects)
}

/**
 * Calculate the "slot height" for an item - the distance from this item's top
 * to the next item's top. This naturally includes any CSS gap between items.
 * For the last item, uses the item's height plus the inferred gap.
 */
function getSlotHeight(
	itemIndex: number,
	items: string[],
	rects: Map<string, DOMRect>,
	inferredGap: number
): number {
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
	// Last item: use height + inferred gap for consistent slot sizing
	return rect.height + inferredGap;
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

	// Infer the CSS gap once for use in all slot height calculations
	const gap = inferGap(items, rects);

	// Calculate the "slot height" for the active item - this is the space it occupies
	// including any gap after it. This is what other items need to shift by.
	const activeSlotHeight = getSlotHeight(activeIndex, items, rects, gap);

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
				activeItemTransformY += getSlotHeight(i, items, rects, gap);
			}
		} else {
			// Dragging up: items from insertionIndex to activeIndex-1 (inclusive) shift down
			// Example: activeIndex=5, insertionIndex=2
			// Items at indices 2, 3, 4 shift down
			if (i >= insertionIndex && i < activeIndex) {
				shouldShift = true;
				shiftDirection = 1; // Shift down
				// Active item moves up by this item's slot height (height + gap)
				activeItemTransformY -= getSlotHeight(i, items, rects, gap);
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

/**
 * Calculate transforms for a vertical sortable list with multiple active (dragged) items.
 *
 * This extends calculateSortingTransforms to handle multi-cell drag operations:
 * - The primary active item (first in activeIds) transforms to the insertion position
 * - Non-primary active items get scaleY: ~0.02 to collapse visually to thin lines
 * - Non-active items shift to make room for the collapsed drag group
 *
 * NOTE: Using scaleY for collapse animation. This visually shrinks cells but maintains
 * their DOM box size. Non-dragged cells shift via transforms to fill the visual gap.
 * If this causes layout issues (e.g., interaction with scroll containers or accessibility),
 * consider switching to actual height animation, which would require tracking original
 * heights and coordinating with the FLIP animation system differently.
 */
export function calculateMultiSortingTransforms(
	items: string[],
	rects: Map<string, DOMRect>,
	activeIds: string[],
	insertionIndex: number | null
): Map<string, ItemTransform> {
	const transforms = new Map<string, ItemTransform>();

	// If no active items or no insertion target, return empty transforms
	if (activeIds.length === 0 || insertionIndex === null) {
		return transforms;
	}

	// Single item case - delegate to existing function for backward compatibility
	if (activeIds.length === 1) {
		return calculateSortingTransforms(items, rects, activeIds[0], insertionIndex);
	}

	// Get indices of all active items, sorted by position
	const activeIndices = activeIds
		.map(id => items.indexOf(id))
		.filter(idx => idx !== -1)
		.sort((a, b) => a - b);

	if (activeIndices.length === 0) {
		return transforms;
	}

	const primaryActiveId = activeIds[0];
	const primaryActiveIndex = items.indexOf(primaryActiveId);
	if (primaryActiveIndex === -1) {
		return transforms;
	}

	const primaryRect = rects.get(primaryActiveId);
	if (!primaryRect) {
		return transforms;
	}

	// Infer the CSS gap once for use in all slot height calculations
	const gap = inferGap(items, rects);

	// Calculate total "slot height" of all active items combined
	// This is the space they occupy together, which non-active items need to shift around
	let totalActiveSlotHeight = 0;
	for (const idx of activeIndices) {
		totalActiveSlotHeight += getSlotHeight(idx, items, rects, gap);
	}

	// Height of just the primary item's slot (for positioning calculations)
	const primarySlotHeight = getSlotHeight(primaryActiveIndex, items, rects, gap);

	// Calculate collapsed height for non-primary active items
	// We collapse them to a thin line (~4px visual height)
	const collapsedHeight = 4;

	// Set to track active item indices for efficient lookup
	const activeIndexSet = new Set(activeIndices);

	// Determine drag direction based on primary item
	const firstActiveIndex = activeIndices[0];
	const isDraggingDown = insertionIndex > firstActiveIndex;

	// Check if we're at original position (no movement needed for primary)
	const atOriginalPosition = insertionIndex === firstActiveIndex || insertionIndex === activeIndices[activeIndices.length - 1] + 1;

	// Calculate the transform for the primary active item to move to insertion position
	let primaryTransformY = 0;

	// Only calculate shifts if not at original position
	if (!atOriginalPosition) {
		// Process all items
		for (let i = 0; i < items.length; i++) {
			const id = items[i];
			const itemRect = rects.get(id);
			if (!itemRect) {
				continue;
			}

			// Skip active items for shift calculation (they get special handling)
			if (activeIndexSet.has(i)) {
				continue;
			}

			let shouldShift = false;
			let shiftDirection = 0;

			if (isDraggingDown) {
				// Dragging down: items between first active and insertion point shift up
				if (i > firstActiveIndex && i < insertionIndex) {
					shouldShift = true;
					shiftDirection = -1; // Shift up
					// Primary item moves down by this item's slot height
					primaryTransformY += getSlotHeight(i, items, rects, gap);
				}
			} else {
				// Dragging up: items between insertion point and first active shift down
				if (i >= insertionIndex && i < firstActiveIndex) {
					shouldShift = true;
					shiftDirection = 1; // Shift down
					// Primary item moves up by this item's slot height
					primaryTransformY -= getSlotHeight(i, items, rects, gap);
				}
			}

			if (shouldShift) {
				// When dragging DOWN: items shift UP by totalActiveSlotHeight to fill vacated space.
				// When dragging UP: items shift DOWN by visualDragSize (only what's visually needed).
				const nonPrimaryCount = activeIndices.length - 1;
				const visualDragSize = primarySlotHeight + (nonPrimaryCount * (collapsedHeight + gap));
				const shiftAmount = isDraggingDown ? totalActiveSlotHeight : visualDragSize;
				transforms.set(id, {
					x: 0,
					y: shiftDirection * shiftAmount,
				});
			}
		}

		// Set transform for primary active item
		if (primaryTransformY !== 0) {
			transforms.set(primaryActiveId, {
				x: 0,
				y: primaryTransformY,
			});
		}

		// When multiple cells are being dragged, non-primary cells collapse to thin lines.
		// This creates visual gaps that need to be closed.
		if (activeIndices.length > 1) {
			const nonPrimaryCount = activeIndices.length - 1;
			const visualDragSize = primarySlotHeight + (nonPrimaryCount * (collapsedHeight + gap));
			const gapToClose = totalActiveSlotHeight - visualDragSize;

			if (isDraggingDown) {
				// Dragging DOWN: gap is between collapsed cells and items below insertion point.
				// Shift items at/after insertion UP to close this gap.
				for (let i = insertionIndex; i < items.length; i++) {
					if (activeIndexSet.has(i)) {
						continue;
					}
					const id = items[i];
					const existing = transforms.get(id);
					transforms.set(id, {
						x: existing?.x ?? 0,
						y: (existing?.y ?? 0) - gapToClose,
					});
				}
			} else {
				// Dragging UP: gap is where active cells vacated their positions.
				// Shift items after the last active index UP to fill this gap.
				const lastActiveIndex = activeIndices[activeIndices.length - 1];
				for (let i = lastActiveIndex + 1; i < items.length; i++) {
					if (activeIndexSet.has(i)) {
						continue;
					}
					const id = items[i];
					const existing = transforms.get(id);
					transforms.set(id, {
						x: existing?.x ?? 0,
						y: (existing?.y ?? 0) - gapToClose,
					});
				}
			}
		}
	}

	// Calculate the primary cell's final visual position (where it will appear after transform)
	const primaryFinalTop = primaryRect.top + primaryTransformY;
	const primaryFinalBottom = primaryFinalTop + primaryRect.height;

	// Partition non-primary active items into "above primary" and "below primary" groups
	// based on their original document order relative to the primary
	const nonPrimaryAbove: string[] = [];
	const nonPrimaryBelow: string[] = [];

	for (let i = 1; i < activeIds.length; i++) {
		const id = activeIds[i];
		const idx = items.indexOf(id);
		if (idx === -1) {
			continue;
		}
		if (idx < primaryActiveIndex) {
			nonPrimaryAbove.push(id);
		} else {
			nonPrimaryBelow.push(id);
		}
	}

	// Sort by index to maintain document order within each group
	nonPrimaryAbove.sort((a, b) => items.indexOf(a) - items.indexOf(b));
	nonPrimaryBelow.sort((a, b) => items.indexOf(a) - items.indexOf(b));

	// Stack collapsed indicators above the primary cell (from bottom to top)
	// The last item in nonPrimaryAbove should be closest to primary
	for (let i = 0; i < nonPrimaryAbove.length; i++) {
		const id = nonPrimaryAbove[i];
		const rect = rects.get(id);
		if (!rect) {
			continue;
		}
		// Position from primary's top, stacking upward
		// i=0 is furthest from primary, i=length-1 is closest
		const stackOffset = (nonPrimaryAbove.length - 1 - i) * collapsedHeight;
		const targetTop = primaryFinalTop - collapsedHeight - stackOffset;
		transforms.set(id, {
			x: 0,
			y: targetTop - rect.top,
			scaleY: collapsedHeight / rect.height,
		});
	}

	// Stack collapsed indicators below the primary cell (from top to bottom)
	// The first item in nonPrimaryBelow should be closest to primary
	for (let i = 0; i < nonPrimaryBelow.length; i++) {
		const id = nonPrimaryBelow[i];
		const rect = rects.get(id);
		if (!rect) {
			continue;
		}
		// Position from primary's bottom, stacking downward
		// i=0 is closest to primary
		const targetTop = primaryFinalBottom + (i * collapsedHeight);
		transforms.set(id, {
			x: 0,
			y: targetTop - rect.top,
			scaleY: collapsedHeight / rect.height,
		});
	}

	return transforms;
}
