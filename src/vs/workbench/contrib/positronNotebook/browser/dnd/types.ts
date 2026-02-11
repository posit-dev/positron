/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DragState {
	status: 'idle' | 'dragging';
	activeId: string | null;
	/** All active IDs for multi-drag (includes activeId as first element) */
	activeIds: string[];
	overId: string | null;
	/** The index where the dragged item should be inserted (0 = before first, n = after last) */
	insertionIndex: number | null;
	initialPosition: { x: number; y: number } | null;
	currentPosition: { x: number; y: number } | null;
	// Initial rect of the dragged element - used for overlay positioning
	initialRect: DOMRect | null;
	// Initial rects of all droppables at drag start - used for collision detection
	// to avoid feedback loops caused by CSS transforms
	initialDroppableRects: Map<string, DOMRect> | null;
	// Scroll offset at drag start - used to adjust initial rects during scroll
	initialScrollOffset: number | null;
}

export interface DroppableEntry {
	id: string;
	node: HTMLElement;
	rect: DOMRect;
}

export interface DragStartEvent {
	active: { id: string };
}

export interface DragMoveEvent {
	active: { id: string };
	over: { id: string } | null;
	delta: { x: number; y: number };
}

export interface DragEndEvent {
	active: { id: string };
	over: { id: string } | null;
	/** The index where the dragged item should be inserted */
	insertionIndex: number | null;
}

export interface DragCancelEvent {
	active: { id: string };
}

export interface SensorOptions {
	activationConstraint?: {
		distance?: number;
	};
}

export interface KeyboardCoordinateGetter {
	(event: KeyboardEvent, args: {
		currentCoordinates: { x: number; y: number };
		context: {
			droppableRects: Map<string, DOMRect>;
			activeId: string | null;
		};
	}): { x: number; y: number } | undefined;
}

export interface AutoScrollOptions {
	enabled?: boolean;
	threshold?: number; // Pixels from edge to start scrolling (default: 50)
	speed?: number; // Pixels per frame (default: 10)
}

export interface ItemTransform {
	x: number;
	y: number;
	scaleX?: number;
	scaleY?: number;
}

export interface AnimationConfig {
	duration?: number;      // ms, default 200
	easing?: string;        // CSS easing, default 'ease'
}

export interface SortingState {
	activeId: string | null;
	overId: string | null;
	itemTransforms: Map<string, ItemTransform>;
}
