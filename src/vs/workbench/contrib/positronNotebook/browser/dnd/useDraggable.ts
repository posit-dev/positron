/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDndContext } from './DndContext.js';

interface UseDraggableProps {
	id: string;
}

export function useDraggable({ id }: UseDraggableProps) {
	const { state, startDrag } = useDndContext();
	const nodeRef = React.useRef<HTMLElement | null>(null);
	const activatorRef = React.useRef<HTMLElement | null>(null);

	const isDragging = state.activeId === id;

	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		nodeRef.current = node;
	}, []);

	const setActivatorNodeRef = React.useCallback((node: HTMLElement | null) => {
		activatorRef.current = node;
	}, []);

	const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		// Store initial element rect for overlay positioning
		const rect = nodeRef.current?.getBoundingClientRect();
		startDrag(id, { x: e.clientX, y: e.clientY }, rect ?? null);
	}, [id, startDrag]);

	// Attributes for the draggable element
	const attributes = {
		role: 'button' as const,
		tabIndex: 0,
		'aria-pressed': isDragging,
		'aria-describedby': `dnd-instructions-${id}`,
	};

	// Event listeners for the activator (drag handle)
	const listeners = {
		onPointerDown: handlePointerDown,
	};

	// NOTE: The dragging item does NOT get a cursor-following transform.
	// - The DragOverlay follows the cursor (rendered in portal)
	// - The original element stays in place with reduced opacity
	// - FLIP transforms (items shifting) are calculated in Plan 03's animation system
	// For now, return null. Plan 03 will add FLIP transforms for non-dragging items.

	return {
		setNodeRef,
		setActivatorNodeRef,
		attributes,
		listeners,
		isDragging,
		transform: null as { x: number; y: number } | null, // FLIP transforms added in Plan 03
		nodeRef, // Expose for initial rect access
	};
}
