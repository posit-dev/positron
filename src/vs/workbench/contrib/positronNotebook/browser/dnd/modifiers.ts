/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

export type Modifier = (transform: ItemTransform) => ItemTransform;

/**
 * Restrict movement to vertical axis only.
 */
export const restrictToVerticalAxis: Modifier = (transform) => ({
	...transform,
	x: 0,
});

/**
 * Restrict movement to horizontal axis only.
 */
export const restrictToHorizontalAxis: Modifier = (transform) => ({
	...transform,
	y: 0,
});

/**
 * Snap to grid (e.g., 10px increments).
 */
export const snapToGrid = (gridSize: number): Modifier => (transform) => ({
	...transform,
	x: Math.round(transform.x / gridSize) * gridSize,
	y: Math.round(transform.y / gridSize) * gridSize,
});

/**
 * Restrict drag to parent container bounds.
 */
export const restrictToParent = (parentRect: DOMRect, elementRect: DOMRect): Modifier => (transform) => {
	const maxX = parentRect.width - elementRect.width;
	const maxY = parentRect.height - elementRect.height;

	return {
		...transform,
		x: Math.max(0, Math.min(maxX, transform.x)),
		y: Math.max(0, Math.min(maxY, transform.y)),
	};
};

/**
 * Apply multiple modifiers in sequence.
 */
export function composeModifiers(...modifiers: Modifier[]): Modifier {
	return (transform) =>
		modifiers.reduce((acc, modifier) => modifier(acc), transform);
}
