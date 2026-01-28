/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DragState, DroppableEntry, DragStartEvent, DragEndEvent, DragCancelEvent, KeyboardCoordinateGetter, AutoScrollOptions, AnimationConfig } from './types.js';
import { closestCenter } from './collisionDetection.js';
import { AutoScrollController } from './autoScroll.js';
import { AnimationProvider } from './AnimationContext.js';
import { Announcer, getAnnouncement } from './Announcer.js';

interface DndContextValue {
	state: DragState;
	registerDroppable: (id: string, node: HTMLElement) => void;
	unregisterDroppable: (id: string) => void;
	startDrag: (id: string, position: { x: number; y: number }, initialRect: DOMRect | null) => void;
	updateDrag: (position: { x: number; y: number }) => void;
	endDrag: () => void;
	cancelDrag: () => void;
	getDroppableRects: () => Map<string, DOMRect>;
	getDroppableIds: () => string[];
}

const DndReactContext = React.createContext<DndContextValue | null>(null);

interface DndContextProps {
	children: React.ReactNode;
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	onDragCancel?: (event: DragCancelEvent) => void;
	activationDistance?: number; // Pixels to move before drag activates (default: 10)
	// Keyboard support
	keyboardCoordinateGetter?: KeyboardCoordinateGetter;
	// Auto-scroll support
	autoScroll?: AutoScrollOptions;
	scrollContainerRef?: React.RefObject<HTMLElement>;
	// Animation configuration
	animationConfig?: AnimationConfig;
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
	keyboardCoordinateGetter,
	autoScroll,
	scrollContainerRef,
	animationConfig,
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

	// Store keyboard coordinate getter in ref
	const keyboardCoordinateGetterRef = React.useRef(keyboardCoordinateGetter);
	keyboardCoordinateGetterRef.current = keyboardCoordinateGetter;

	// Track dragging state in a ref for use in event handlers (avoids stale closure issues)
	const isDraggingRef = React.useRef(false);
	isDraggingRef.current = state.status === 'dragging';

	// Auto-scroll controller - initialized once and updated via ref
	const autoScrollRef = React.useRef<AutoScrollController | null>(null);

	// Initialize auto-scroll controller once
	if (autoScrollRef.current === null && autoScroll?.enabled !== false) {
		autoScrollRef.current = new AutoScrollController(scrollContainerRef ?? null, {
			threshold: autoScroll?.threshold,
			speed: autoScroll?.speed,
		});
	}

	// Update scroll container ref when it changes
	React.useEffect(() => {
		if (autoScrollRef.current) {
			autoScrollRef.current.setScrollContainerRef(scrollContainerRef ?? null);
		}
	}, [scrollContainerRef]);

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

	// Announcement state for screen readers
	const [announcement, setAnnouncement] = React.useState('');

	// Get fresh rects for all droppables
	const getDroppableRects = React.useCallback((): Map<string, DOMRect> => {
		const rects = new Map<string, DOMRect>();
		for (const [id, entry] of droppablesRef.current) {
			rects.set(id, entry.node.getBoundingClientRect());
		}
		return rects;
	}, []);

	// Get ordered list of droppable IDs
	const getDroppableIds = React.useCallback((): string[] => {
		return Array.from(droppablesRef.current.keys());
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

					// Announce drag start for screen readers
					const items = Array.from(droppablesRef.current.keys());
					const activeIndex = items.indexOf(id);
					setAnnouncement(getAnnouncement('start', activeIndex, null, items.length));
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

			// Auto-scroll when near edges (outside setState to ensure it runs)
			// Use ref to check dragging status since state in closure might be stale
			if (isDraggingRef.current) {
				autoScrollRef.current?.update(position);
			}
		};

		const handlePointerUp = () => {
			// Stop auto-scroll
			autoScrollRef.current?.stop();

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

				// Announce drag end for screen readers
				const items = Array.from(droppablesRef.current.keys());
				const activeIndex = items.indexOf(prev.activeId!);
				const overIndex = prev.overId ? items.indexOf(prev.overId) : null;
				setAnnouncement(getAnnouncement('end', activeIndex, overIndex, items.length));

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
				// Stop auto-scroll
				autoScrollRef.current?.stop();

				if (pendingDrag) {
					setPendingDrag(null);
					return;
				}

				setState(prev => {
					if (prev.status !== 'dragging') {
						return prev;
					}

					onDragCancelRef.current?.({ active: { id: prev.activeId! } });

					// Announce drag cancel for screen readers
					const items = Array.from(droppablesRef.current.keys());
					const activeIndex = items.indexOf(prev.activeId!);
					setAnnouncement(getAnnouncement('cancel', activeIndex, null, items.length));

					return {
						status: 'idle',
						activeId: null,
						overId: null,
						initialPosition: null,
						currentPosition: null,
						initialRect: null,
					};
				});
				return;
			}

			// Handle arrow keys for keyboard navigation during drag
			if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && keyboardCoordinateGetterRef.current) {
				setState(prev => {
					if (prev.status !== 'dragging' || !prev.currentPosition) {
						return prev;
					}

					// Build droppable rects map
					const droppableRects = new Map<string, DOMRect>();
					for (const [id, entry] of droppablesRef.current) {
						// Update rect before using
						entry.rect = entry.node.getBoundingClientRect();
						droppableRects.set(id, entry.rect);
					}

					const newCoords = keyboardCoordinateGetterRef.current!(e, {
						currentCoordinates: prev.currentPosition,
						context: { droppableRects, activeId: prev.activeId },
					});

					if (!newCoords) {
						return prev;
					}

					e.preventDefault();

					// Find closest droppable at new coordinates
					const closest = closestCenter(
						newCoords,
						Array.from(droppablesRef.current.values()),
						prev.activeId
					);

					return {
						...prev,
						currentPosition: newCoords,
						overId: closest?.id ?? null,
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
			getDroppableRects,
			getDroppableIds,
		}),
		[state, registerDroppable, unregisterDroppable, startDrag, updateDrag, endDrag, cancelDrag, getDroppableRects, getDroppableIds]
	);

	return (
		<AnimationProvider config={animationConfig}>
			<DndReactContext.Provider value={value}>
				{children}
				<Announcer message={announcement} />
			</DndReactContext.Provider>
		</AnimationProvider>
	);
}

export function useDndContext() {
	const context = React.useContext(DndReactContext);
	if (!context) {
		throw new Error('useDndContext must be used within a DndContext');
	}
	return context;
}
