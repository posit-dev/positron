/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import * as React from 'react';
import { useDndContext } from './DndContext.js';
import { useTouchSensor, TouchSensorConfig } from './TouchSensor.js';

interface UseDraggableProps {
	id: string;
	touchConfig?: TouchSensorConfig;
}

export function useDraggable({ id, touchConfig }: UseDraggableProps) {
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
		if (e.pointerType === 'touch') {
			return; // Touch uses long-press via TouchSensor
		}
		e.preventDefault();
		// Store initial element rect for overlay positioning
		const rect = nodeRef.current?.getBoundingClientRect();
		startDrag(id, { x: e.clientX, y: e.clientY }, rect ?? null);
	}, [id, startDrag]);

	const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
		// Space or Enter to start drag
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			const rect = nodeRef.current?.getBoundingClientRect();
			if (rect) {
				// Start drag from center of element
				startDrag(id, {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
				}, rect, 'keyboard');
			}
		}
	}, [id, startDrag]);

	// Touch sensor activation callback
	const handleTouchActivate = React.useCallback((position: { x: number; y: number }) => {
		const rect = nodeRef.current?.getBoundingClientRect();
		startDrag(id, position, rect ?? null);
	}, [id, startDrag]);

	// Touch sensor hooks for long-press activation on touch devices
	const touchListeners = useTouchSensor(handleTouchActivate, touchConfig);

	// Attributes for the draggable element
	const attributes = {
		role: 'button' as const,
		tabIndex: 0,
		'aria-pressed': isDragging,
		'aria-describedby': `dnd-instructions-${id}`,
	};

	// Event listeners for the activator (drag handle)
	// Combines pointer, keyboard, and touch events
	const listeners = {
		onPointerDown: handlePointerDown,
		onKeyDown: handleKeyDown,
		...touchListeners,
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
