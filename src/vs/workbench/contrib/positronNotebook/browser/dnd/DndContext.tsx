/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DragState, DroppableEntry, DragStartEvent, DragEndEvent, DragCancelEvent, KeyboardCoordinateGetter, AutoScrollOptions, AnimationConfig } from './types.js';
import { closestCenter, detectInsertionIndex } from './collisionDetection.js';
import { AutoScrollController } from './autoScroll.js';
import { AnimationProvider } from './AnimationContext.js';
import { Announcer, getAnnouncement } from './Announcer.js';
import { useOptionalMultiDragContext } from './MultiDragContext.js';

interface DndContextValue {
	state: DragState;
	registerDroppable: (id: string, node: HTMLElement) => void;
	unregisterDroppable: (id: string) => void;
	startDrag: (id: string, position: { x: number; y: number }, initialRect: DOMRect | null, source?: 'pointer' | 'keyboard') => void;
	updateDrag: (position: { x: number; y: number }) => void;
	endDrag: () => void;
	cancelDrag: () => void;
	getDroppableRects: () => Map<string, DOMRect>;
	getDroppableIds: () => string[];
	getInitialDroppableRects: () => Map<string, DOMRect> | null;
}

const DndReactContext = React.createContext<DndContextValue | null>(null);

interface DndContextProps {
	children: React.ReactNode;
	items?: string[]; // Authoritative items array for collision detection
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	onDragCancel?: (event: DragCancelEvent) => void;
	activationDistance?: number; // Pixels to move before drag activates (default: 10)
	disabled?: boolean; // When true, startDrag is a no-op (used for read-only notebooks)
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
	source: 'pointer' | 'keyboard';
}

const IDLE_STATE: DragState = {
	status: 'idle',
	activeId: null,
	activeIds: [],
	overId: null,
	insertionIndex: null,
	initialPosition: null,
	currentPosition: null,
	initialRect: null,
	initialDroppableRects: null,
	initialScrollOffset: null,
};

export function DndContext({
	children,
	items: itemsProp,
	onDragStart,
	onDragEnd,
	onDragCancel,
	activationDistance = 10,
	disabled = false,
	keyboardCoordinateGetter,
	autoScroll,
	scrollContainerRef,
	animationConfig,
}: DndContextProps) {
	const [state, setState] = React.useState<DragState>({
		status: 'idle',
		activeId: null,
		activeIds: [],
		overId: null,
		insertionIndex: null,
		initialPosition: null,
		currentPosition: null,
		initialRect: null,
		initialDroppableRects: null,
		initialScrollOffset: null,
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

	// Store items prop in ref for use in event handlers
	const itemsPropRef = React.useRef(itemsProp);
	itemsPropRef.current = itemsProp;

	// Get multi-drag context for accessing activeIds at drag start time.
	// Store getActiveIds in a ref so activateDrag and the effect don't depend
	// on multiDragContext identity (which changes on every selection/state change),
	// preventing unnecessary event listener teardown during drag.
	const multiDragContext = useOptionalMultiDragContext();
	const multiDragGetActiveIdsRef = React.useRef(multiDragContext?.getActiveIds);
	multiDragGetActiveIdsRef.current = multiDragContext?.getActiveIds;

	// Get items array - use provided prop or fall back to droppables Map keys
	const getItems = React.useCallback((): string[] => {
		if (itemsPropRef.current) {
			return itemsPropRef.current;
		}
		return Array.from(droppablesRef.current.keys());
	}, []);

	// Track dragging state in a ref for use in event handlers (avoids stale closure issues)
	const isDraggingRef = React.useRef(false);
	isDraggingRef.current = state.status === 'dragging';

	// Mirror full state in a ref so event handlers can read it synchronously
	// without needing to fire callbacks inside setState updaters
	const stateRef = React.useRef(state);
	stateRef.current = state;

	// Auto-scroll controller - lazily initialized in effect to avoid side effects during render
	const autoScrollRef = React.useRef<AutoScrollController | null>(null);

	React.useEffect(() => {
		if (autoScroll?.enabled === false) {
			return;
		}
		if (autoScrollRef.current === null) {
			autoScrollRef.current = new AutoScrollController(scrollContainerRef ?? null, {
				threshold: autoScroll?.threshold,
				speed: autoScroll?.speed,
			});
		} else {
			autoScrollRef.current.setScrollContainerRef(scrollContainerRef ?? null);
		}
	}, [scrollContainerRef, autoScroll?.enabled, autoScroll?.threshold, autoScroll?.speed]);

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

	// Get scroll-adjusted initial rects for stable transform calculations
	// This prevents feedback loops where CSS transforms affect position calculations
	const getInitialDroppableRects = React.useCallback((): Map<string, DOMRect> | null => {
		if (!state.initialDroppableRects || state.initialScrollOffset === null) {
			return null;
		}

		const currentScrollOffset = scrollContainerRef?.current?.scrollTop ?? window.scrollY;
		const scrollDelta = currentScrollOffset - state.initialScrollOffset;

		const adjustedRects = new Map<string, DOMRect>();
		for (const [id, rect] of state.initialDroppableRects) {
			adjustedRects.set(id, new DOMRect(
				rect.x,
				rect.y - scrollDelta,
				rect.width,
				rect.height
			));
		}
		return adjustedRects;
	}, [state.initialDroppableRects, state.initialScrollOffset, scrollContainerRef]);

	const startDrag = React.useCallback((id: string, position: { x: number; y: number }, initialRect: DOMRect | null, source: 'pointer' | 'keyboard' = 'pointer') => {
		if (disabled) {
			return; // Don't start drags when DndContext is disabled (e.g. read-only notebooks)
		}
		// Store pending drag - actual drag starts after activation distance
		setPendingDrag({ id, startPosition: position, initialRect, source });
	}, [disabled]);

	// Shared drag activation logic used by both keyboard and pointer paths.
	// Captures initial rects/scroll, fires onDragStart, resolves activeIds, and sets state.
	const activateDrag = React.useCallback((
		id: string,
		startPosition: { x: number; y: number },
		currentPosition: { x: number; y: number },
		initialRect: DOMRect | null,
	) => {
		const initialDroppableRects = new Map<string, DOMRect>();
		for (const [droppableId, entry] of droppablesRef.current) {
			// Skip detached nodes that may have been unmounted between render and activation
			if (!entry.node.isConnected) {
				continue;
			}
			initialDroppableRects.set(droppableId, entry.node.getBoundingClientRect());
		}
		const initialScrollOffset = scrollContainerRef?.current?.scrollTop ?? window.scrollY;

		// Fire onDragStart FIRST so multi-drag context can set activeIds
		// This updates the multi-drag ref synchronously
		onDragStartRef.current?.({ active: { id } });

		// Now get activeIds from multi-drag context (ref was updated by startMultiDrag)
		// Fall back to single activeId if no multi-drag context
		const activeIds = multiDragGetActiveIdsRef.current?.() ?? [id];

		// Announce drag start for screen readers
		const items = getItems();
		const activeIndex = items.indexOf(id);
		setAnnouncement(getAnnouncement('start', activeIndex, null, items.length));

		setState({
			status: 'dragging',
			activeId: id,
			activeIds: activeIds.length > 0 ? activeIds : [id],
			overId: null,
			insertionIndex: null,
			initialPosition: startPosition,
			currentPosition,
			initialRect,
			initialDroppableRects,
			initialScrollOffset,
		});
	}, [scrollContainerRef, getItems]);

	// Global pointer event handlers - attached immediately when pending or dragging
	React.useEffect(() => {
		// Keyboard drags activate immediately (no movement threshold needed)
		if (pendingDrag?.source === 'keyboard') {
			const { id, startPosition, initialRect } = pendingDrag;
			setPendingDrag(null);
			activateDrag(id, startPosition, startPosition, initialRect);
			return; // Don't attach pointer listeners for keyboard drag
		}

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
					setPendingDrag(null);
					activateDrag(id, startPosition, position, initialRect);
				}
				return;
			}

			// Update drag state
			setState(prev => {
				if (prev.status !== 'dragging') {
					return prev;
				}

				// Update droppable rects in the registry (needed for animations via getDroppableRects)
				for (const [, entry] of droppablesRef.current) {
					entry.rect = entry.node.getBoundingClientRect();
				}

				// For collision detection, use scroll-adjusted INITIAL rects
				// This prevents feedback loops where CSS transforms affect collision detection
				const items = getItems();
				let collisionRects: Map<string, DOMRect>;

				if (prev.initialDroppableRects && prev.initialScrollOffset !== null) {
					// Calculate scroll delta and adjust initial rects
					const currentScrollOffset = scrollContainerRef?.current?.scrollTop ?? window.scrollY;
					const scrollDelta = currentScrollOffset - prev.initialScrollOffset;

					collisionRects = new Map<string, DOMRect>();
					for (const [id, rect] of prev.initialDroppableRects) {
						// Adjust for scroll: rects move up (negative y) when scrolling down (positive delta)
						collisionRects.set(id, new DOMRect(
							rect.x,
							rect.y - scrollDelta,
							rect.width,
							rect.height
						));
					}
				} else {
					// Fallback: use live rects if initial rects not available
					collisionRects = new Map<string, DOMRect>();
					for (const [id, entry] of droppablesRef.current) {
						collisionRects.set(id, entry.rect);
					}
				}

				// Find closest droppable using scroll-adjusted initial rects
				const droppableEntries = items
					.filter(id => collisionRects.has(id))
					.map(id => ({
						id,
						node: droppablesRef.current.get(id)?.node ?? null,
						rect: collisionRects.get(id)!,
					}))
					.filter(entry => entry.node !== null) as { id: string; node: HTMLElement; rect: DOMRect }[];

				const closest = closestCenter(
					position,
					droppableEntries,
					prev.activeId
				);

				// Calculate insertion index using scroll-adjusted initial rects
				// Use all active IDs from multi-drag context for proper collision detection
				const insertionIndex = detectInsertionIndex(
					position.y,
					items,
					collisionRects,
					prev.activeIds.length > 0 ? prev.activeIds : [prev.activeId!]
				);

				return {
					...prev,
					currentPosition: position,
					overId: closest?.id ?? null,
					insertionIndex,
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

			const prev = stateRef.current;
			if (prev.status !== 'dragging') {
				return;
			}

			// Fire callback synchronously before state transition
			onDragEndRef.current?.({
				active: { id: prev.activeId! },
				over: prev.overId ? { id: prev.overId } : null,
				insertionIndex: prev.insertionIndex,
			});

			// Announce drag end for screen readers
			const items = getItems();
			const activeIndex = items.indexOf(prev.activeId!);
			const overIndex = prev.overId ? items.indexOf(prev.overId) : null;
			setAnnouncement(getAnnouncement('end', activeIndex, overIndex, items.length));

			setState(IDLE_STATE);
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				// Stop auto-scroll
				autoScrollRef.current?.stop();

				if (pendingDrag) {
					setPendingDrag(null);
					return;
				}

				const prev = stateRef.current;
				if (prev.status !== 'dragging') {
					return;
				}

				// Fire callback synchronously before state transition
				onDragCancelRef.current?.({ active: { id: prev.activeId! } });

				// Announce drag cancel for screen readers
				const items = getItems();
				const activeIndex = items.indexOf(prev.activeId!);
				setAnnouncement(getAnnouncement('cancel', activeIndex, null, items.length));

				setState(IDLE_STATE);
				return;
			}

			// Space/Enter to drop during keyboard drag
			if ((e.key === ' ' || e.key === 'Enter') && isDraggingRef.current) {
				e.preventDefault();
				autoScrollRef.current?.stop();

				const prev = stateRef.current;
				if (prev.status !== 'dragging') {
					return;
				}

				// Fire callback synchronously before state transition
				onDragEndRef.current?.({
					active: { id: prev.activeId! },
					over: prev.overId ? { id: prev.overId } : null,
					insertionIndex: prev.insertionIndex,
				});

				// Announce drag end for screen readers
				const items = getItems();
				const activeIndex = items.indexOf(prev.activeId!);
				const overIndex = prev.overId ? items.indexOf(prev.overId) : null;
				setAnnouncement(getAnnouncement('end', activeIndex, overIndex, items.length));

				setState(IDLE_STATE);
				return;
			}

			// Handle arrow keys for keyboard navigation during drag
			if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && keyboardCoordinateGetterRef.current) {
				setState(prev => {
					if (prev.status !== 'dragging' || !prev.currentPosition) {
						return prev;
					}

					// Update droppable rects in the registry (needed for animations)
					for (const [, entry] of droppablesRef.current) {
						entry.rect = entry.node.getBoundingClientRect();
					}

					// For collision detection, use scroll-adjusted INITIAL rects
					const items = getItems();
					let collisionRects: Map<string, DOMRect>;

					if (prev.initialDroppableRects && prev.initialScrollOffset !== null) {
						// Calculate scroll delta and adjust initial rects
						const currentScrollOffset = scrollContainerRef?.current?.scrollTop ?? window.scrollY;
						const scrollDelta = currentScrollOffset - prev.initialScrollOffset;

						collisionRects = new Map<string, DOMRect>();
						for (const [id, rect] of prev.initialDroppableRects) {
							collisionRects.set(id, new DOMRect(
								rect.x,
								rect.y - scrollDelta,
								rect.width,
								rect.height
							));
						}
					} else {
						// Fallback: use live rects
						collisionRects = new Map<string, DOMRect>();
						for (const [id, entry] of droppablesRef.current) {
							collisionRects.set(id, entry.rect);
						}
					}

					const newCoords = keyboardCoordinateGetterRef.current!(e, {
						currentCoordinates: prev.currentPosition,
						context: { droppableRects: collisionRects, activeId: prev.activeId },
					});

					if (!newCoords) {
						return prev;
					}

					e.preventDefault();

					// Find closest droppable using scroll-adjusted initial rects
					const droppableEntries = items
						.filter(id => collisionRects.has(id))
						.map(id => ({
							id,
							node: droppablesRef.current.get(id)?.node ?? null,
							rect: collisionRects.get(id)!,
						}))
						.filter(entry => entry.node !== null) as { id: string; node: HTMLElement; rect: DOMRect }[];

					const closest = closestCenter(
						newCoords,
						droppableEntries,
						prev.activeId
					);

					// Calculate insertion index using scroll-adjusted initial rects
					// Use all active IDs from multi-drag context for proper collision detection
					const insertionIndex = detectInsertionIndex(
						newCoords.y,
						items,
						collisionRects,
						prev.activeIds.length > 0 ? prev.activeIds : [prev.activeId!]
					);

					return {
						...prev,
						currentPosition: newCoords,
						overId: closest?.id ?? null,
						insertionIndex,
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
	}, [state.status, pendingDrag, activationDistance, activateDrag, getItems, scrollContainerRef]);

	// Handle scroll events during drag - recalculate collision detection
	// since cell positions change relative to viewport during scroll
	React.useEffect(() => {
		if (state.status !== 'dragging' || !state.currentPosition) {
			return;
		}

		const handleScroll = () => {
			setState(prev => {
				if (prev.status !== 'dragging' || !prev.currentPosition) {
					return prev;
				}

				// Update droppable rects in the registry (needed for animations via getDroppableRects)
				for (const [, entry] of droppablesRef.current) {
					entry.rect = entry.node.getBoundingClientRect();
				}

				// For collision detection, use scroll-adjusted INITIAL rects
				// This prevents feedback loops where CSS transforms affect collision detection
				const items = getItems();
				let collisionRects: Map<string, DOMRect>;

				if (prev.initialDroppableRects && prev.initialScrollOffset !== null) {
					// Calculate scroll delta and adjust initial rects
					const currentScrollOffset = scrollContainerRef?.current?.scrollTop ?? window.scrollY;
					const scrollDelta = currentScrollOffset - prev.initialScrollOffset;

					collisionRects = new Map<string, DOMRect>();
					for (const [id, rect] of prev.initialDroppableRects) {
						// Adjust for scroll: rects move up (negative y) when scrolling down (positive delta)
						collisionRects.set(id, new DOMRect(
							rect.x,
							rect.y - scrollDelta,
							rect.width,
							rect.height
						));
					}
				} else {
					// Fallback: use live rects if initial rects not available
					collisionRects = new Map<string, DOMRect>();
					for (const [id, entry] of droppablesRef.current) {
						collisionRects.set(id, entry.rect);
					}
				}

				// Find closest droppable using scroll-adjusted initial rects
				const droppableEntries = items
					.filter(id => collisionRects.has(id))
					.map(id => ({
						id,
						node: droppablesRef.current.get(id)?.node ?? null,
						rect: collisionRects.get(id)!,
					}))
					.filter(entry => entry.node !== null) as { id: string; node: HTMLElement; rect: DOMRect }[];

				const closest = closestCenter(
					prev.currentPosition,
					droppableEntries,
					prev.activeId
				);

				// Calculate insertion index using scroll-adjusted initial rects
				// Use all active IDs from multi-drag context for proper collision detection
				const insertionIndex = detectInsertionIndex(
					prev.currentPosition.y,
					items,
					collisionRects,
					prev.activeIds.length > 0 ? prev.activeIds : [prev.activeId!]
				);

				const newOverId = closest?.id ?? null;

				// Only update if overId or insertionIndex changed
				if (newOverId === prev.overId && insertionIndex === prev.insertionIndex) {
					return prev;
				}

				return {
					...prev,
					overId: newOverId,
					insertionIndex,
				};
			});
		};

		// Listen for scroll on the scroll container and window
		const scrollContainer = scrollContainerRef?.current;
		scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });
		window.addEventListener('scroll', handleScroll, { passive: true });

		return () => {
			scrollContainer?.removeEventListener('scroll', handleScroll);
			window.removeEventListener('scroll', handleScroll);
		};
	}, [state.status, state.currentPosition, scrollContainerRef, getItems]);

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
			getInitialDroppableRects,
		}),
		[state, registerDroppable, unregisterDroppable, startDrag, updateDrag, endDrag, cancelDrag, getDroppableRects, getDroppableIds, getInitialDroppableRects]
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
