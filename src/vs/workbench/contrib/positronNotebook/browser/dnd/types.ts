/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DragState {
	status: 'idle' | 'dragging';
	activeId: string | null;
	overId: string | null;
	initialPosition: { x: number; y: number } | null;
	currentPosition: { x: number; y: number } | null;
	// Initial rect of the dragged element - used for overlay positioning
	initialRect: DOMRect | null;
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
}

export interface DragCancelEvent {
	active: { id: string };
}
