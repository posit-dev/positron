/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DragState, DroppableEntry, DragStartEvent, DragEndEvent, DragCancelEvent } from './types.js';
import { closestCenter } from './collisionDetection.js';

interface DndContextValue {
	state: DragState;
	registerDroppable: (id: string, node: HTMLElement) => void;
	unregisterDroppable: (id: string) => void;
	startDrag: (id: string, position: { x: number; y: number }, initialRect: DOMRect | null) => void;
	updateDrag: (position: { x: number; y: number }) => void;
	endDrag: () => void;
	cancelDrag: () => void;
}

const DndReactContext = React.createContext<DndContextValue | null>(null);

interface DndContextProps {
	children: React.ReactNode;
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	onDragCancel?: (event: DragCancelEvent) => void;
	activationDistance?: number; // Pixels to move before drag activates (default: 10)
}

interface PendingDrag {
	id: string;
	startPosition: { x: number; y: number };
	initialRect: DOMRect | null;
}

export function DndContext({
	children,
	onDragStart,
	onDragEnd,
	onDragCancel,
	activationDistance = 10,
}: DndContextProps) {
	const [state, setState] = React.useState<DragState>({
		status: 'idle',
		activeId: null,
		overId: null,
		initialPosition: null,
		currentPosition: null,
		initialRect: null,
	});

	// Track pending drag as state so it triggers re-render and attaches listeners
	const [pendingDrag, setPendingDrag] = React.useState<PendingDrag | null>(null);

	const droppablesRef = React.useRef<Map<string, DroppableEntry>>(new Map());

	// Store callbacks in refs to avoid stale closures in event handlers
	const onDragStartRef = React.useRef(onDragStart);
	const onDragEndRef = React.useRef(onDragEnd);
	const onDragCancelRef = React.useRef(onDragCancel);
	onDragStartRef.current = onDragStart;
	onDragEndRef.current = onDragEnd;
	onDragCancelRef.current = onDragCancel;

	const registerDroppable = React.useCallback((id: string, node: HTMLElement) => {
		droppablesRef.current.set(id, {
			id,
			node,
			rect: node.getBoundingClientRect(),
		});
	}, []);

	const unregisterDroppable = React.useCallback((id: string) => {
		droppablesRef.current.delete(id);
	}, []);

	const startDrag = React.useCallback((id: string, position: { x: number; y: number }, initialRect: DOMRect | null) => {
		// Store pending drag - actual drag starts after activation distance
		setPendingDrag({ id, startPosition: position, initialRect });
	}, []);

	// Global pointer event handlers - attached immediately when pending or dragging
	React.useEffect(() => {
		const handlePointerMove = (e: PointerEvent) => {
			const position = { x: e.clientX, y: e.clientY };

			// Check if we need to activate pending drag
			if (pendingDrag) {
				const { id, startPosition, initialRect } = pendingDrag;
				const distance = Math.sqrt(
					Math.pow(position.x - startPosition.x, 2) +
					Math.pow(position.y - startPosition.y, 2)
				);

				if (distance >= activationDistance) {
					// Activate drag
					setPendingDrag(null);
					setState({
						status: 'dragging',
						activeId: id,
						overId: null,
						initialPosition: startPosition,
						currentPosition: position,
						initialRect,
					});
					onDragStartRef.current?.({ active: { id } });
				}
				return;
			}

			// Update drag state
			setState(prev => {
				if (prev.status !== 'dragging') {
					return prev;
				}

				// Update droppable rects (they may have changed)
				for (const [, entry] of droppablesRef.current) {
					entry.rect = entry.node.getBoundingClientRect();
				}

				// Find closest droppable
				const closest = closestCenter(
					position,
					Array.from(droppablesRef.current.values()),
					prev.activeId
				);

				return {
					...prev,
					currentPosition: position,
					overId: closest?.id ?? null,
				};
			});
		};

		const handlePointerUp = () => {
			if (pendingDrag) {
				// Drag never activated, just reset
				setPendingDrag(null);
				return;
			}

			setState(prev => {
				if (prev.status !== 'dragging') {
					return prev;
				}

				// Fire the end callback
				onDragEndRef.current?.({
					active: { id: prev.activeId! },
					over: prev.overId ? { id: prev.overId } : null,
				});

				return {
					status: 'idle',
					activeId: null,
					overId: null,
					initialPosition: null,
					currentPosition: null,
					initialRect: null,
				};
			});
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (pendingDrag) {
					setPendingDrag(null);
					return;
				}

				setState(prev => {
					if (prev.status !== 'dragging') {
						return prev;
					}

					onDragCancelRef.current?.({ active: { id: prev.activeId! } });

					return {
						status: 'idle',
						activeId: null,
						overId: null,
						initialPosition: null,
						currentPosition: null,
						initialRect: null,
					};
				});
			}
		};

		const isActive = state.status === 'dragging' || pendingDrag !== null;

		if (isActive) {
			window.addEventListener('pointermove', handlePointerMove);
			window.addEventListener('pointerup', handlePointerUp);
			window.addEventListener('keydown', handleKeyDown);
		}

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [state.status, pendingDrag, activationDistance]);

	// Create stable callbacks that don't change identity
	const updateDrag = React.useCallback((_position: { x: number; y: number }) => {
		// This is handled by the effect now, but we keep this for API compatibility
	}, []);

	const endDrag = React.useCallback(() => {
		// This is handled by the effect now, but we keep this for API compatibility
	}, []);

	const cancelDrag = React.useCallback(() => {
		// This is handled by the effect now, but we keep this for API compatibility
	}, []);

	const value = React.useMemo(
		() => ({
			state,
			registerDroppable,
			unregisterDroppable,
			startDrag,
			updateDrag,
			endDrag,
			cancelDrag,
		}),
		[state, registerDroppable, unregisterDroppable, startDrag, updateDrag, endDrag, cancelDrag]
	);

	return (
		<DndReactContext.Provider value={value}>
			{children}
		</DndReactContext.Provider>
	);
}

export function useDndContext() {
	const context = React.useContext(DndReactContext);
	if (!context) {
		throw new Error('useDndContext must be used within a DndContext');
	}
	return context;
}
