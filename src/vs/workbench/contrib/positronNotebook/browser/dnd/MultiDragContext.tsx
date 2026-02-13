/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export interface MultiDragState {
	activeIds: string[];
	overId: string | null;
	isDragging: boolean;
}

export interface MultiDragContextValue {
	state: MultiDragState;
	selectedIds: string[];
	orderedIds: string[];
	startMultiDrag: (primaryId: string) => void;
	updateMultiDrag: (overId: string | null) => void;
	endMultiDrag: () => void;
	cancelMultiDrag: () => void;
	// Synchronous access to activeIds (updated immediately, bypasses React state batching)
	getActiveIds: () => string[];
}

const MultiDragReactContext = React.createContext<MultiDragContextValue | null>(null);

interface MultiDragProviderProps {
	children: React.ReactNode;
	selectedIds: string[];
	orderedIds: string[];
	onReorder?: (fromIndices: number[], toIndex: number) => void;
}

/**
 * Provider for multi-cell drag-and-drop functionality.
 * Works alongside the existing DndContext to enable dragging multiple selected cells.
 */
export function MultiDragProvider({
	children,
	selectedIds,
	orderedIds,
	onReorder,
}: MultiDragProviderProps) {
	const [state, setState] = React.useState<MultiDragState>({
		activeIds: [],
		overId: null,
		isDragging: false,
	});

	// Store callback in ref to avoid stale closures
	const onReorderRef = React.useRef(onReorder);
	onReorderRef.current = onReorder;

	// Store selectedIds in ref for use in startMultiDrag to avoid stale closure issues
	const selectedIdsRef = React.useRef(selectedIds);
	selectedIdsRef.current = selectedIds;
	const orderedIdsRef = React.useRef(orderedIds);
	orderedIdsRef.current = orderedIds;

	// Synchronous ref for activeIds - updated immediately when startMultiDrag is called,
	// bypassing React's state batching. This allows consumers to access the activeIds
	// synchronously within the same event handler cycle.
	const activeIdsRef = React.useRef<string[]>([]);

	const startMultiDrag = React.useCallback((primaryId: string) => {
		// Use selectedIds from ref to get the latest value (avoids stale closure issues)
		const currentSelectedIds = selectedIdsRef.current;
		const currentOrderedIds = orderedIdsRef.current;
		const orderedIndex = new Map(currentOrderedIds.map((id, idx) => [id, idx]));
		const sortedSelectedIds = [...currentSelectedIds].sort(
			(a, b) => (orderedIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderedIndex.get(b) ?? Number.MAX_SAFE_INTEGER)
		);
		// If the primary drag item is in the selection, drag all selected items
		// Otherwise, only drag the single item
		// IMPORTANT: The primaryId (the cell being dragged) must be FIRST in the array
		// because activeIds[0] is used as the primary for transforms and collapse logic
		const idsToMove = sortedSelectedIds.includes(primaryId)
			? [primaryId, ...sortedSelectedIds.filter(id => id !== primaryId)]
			: [primaryId];

		// Update ref synchronously BEFORE setState (bypasses React batching)
		activeIdsRef.current = idsToMove;

		setState({
			activeIds: idsToMove,
			overId: null,
			isDragging: true,
		});
	}, []);

	const updateMultiDrag = React.useCallback((overId: string | null) => {
		setState(prev => ({
			...prev,
			overId,
		}));
	}, []);

	const endMultiDrag = React.useCallback(() => {
		activeIdsRef.current = [];
		setState({
			activeIds: [],
			overId: null,
			isDragging: false,
		});
	}, []);

	const cancelMultiDrag = React.useCallback(() => {
		activeIdsRef.current = [];
		setState({
			activeIds: [],
			overId: null,
			isDragging: false,
		});
	}, []);

	// Synchronous getter for activeIds - returns the ref value which is updated
	// immediately when startMultiDrag is called (before React state batching)
	const getActiveIds = React.useCallback(() => activeIdsRef.current, []);

	const value = React.useMemo(
		() => ({
			state,
			selectedIds,
			orderedIds,
			startMultiDrag,
			updateMultiDrag,
			endMultiDrag,
			cancelMultiDrag,
			getActiveIds,
		}),
		[state, selectedIds, orderedIds, startMultiDrag, updateMultiDrag, endMultiDrag, cancelMultiDrag, getActiveIds]
	);

	return (
		<MultiDragReactContext.Provider value={value}>
			{children}
		</MultiDragReactContext.Provider>
	);
}

export function useMultiDragContext() {
	const context = React.useContext(MultiDragReactContext);
	if (!context) {
		throw new Error('useMultiDragContext must be used within a MultiDragProvider');
	}
	return context;
}

/**
 * Hook to safely access MultiDragContext (returns null if not available).
 * Use this when the component may or may not be wrapped in a MultiDragProvider.
 */
export function useOptionalMultiDragContext(): MultiDragContextValue | null {
	return React.useContext(MultiDragReactContext);
}

/**
 * Hook for determining if an item is part of a multi-drag operation.
 * Returns null if multi-drag context is not available.
 */
export function useMultiDragState(itemId: string) {
	const context = React.useContext(MultiDragReactContext);

	if (!context) {
		return null;
	}

	const { state, selectedIds } = context;
	const { orderedIds } = context;
	const isSelected = selectedIds.includes(itemId);
	const isBeingDragged = state.activeIds.includes(itemId);
	const isPrimaryDrag = state.activeIds[0] === itemId;
	const dragCount = state.activeIds.length;
	let draggedAboveCount = 0;
	let draggedBelowCount = 0;

	if (isPrimaryDrag && dragCount > 1) {
		const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
		const primaryOrderIndex = orderMap.get(itemId) ?? -1;
		if (primaryOrderIndex !== -1) {
			for (const id of state.activeIds.slice(1)) {
				const idx = orderMap.get(id) ?? -1;
				if (idx !== -1 && idx < primaryOrderIndex) {
					draggedAboveCount++;
				} else if (idx !== -1 && idx > primaryOrderIndex) {
					draggedBelowCount++;
				}
			}
		}
	}

	return {
		isSelected,
		isBeingDragged,
		isPrimaryDrag,
		dragCount,
		draggedAboveCount,
		draggedBelowCount,
		hasDraggedAbove: draggedAboveCount > 0,
		hasDraggedBelow: draggedBelowCount > 0,
		isDragging: state.isDragging,
	};
}

/**
 * Calculate the indices of items to move based on multi-drag state.
 * @param items - Array of item IDs in order
 * @param activeIds - Array of IDs being dragged
 * @param overId - The target drop position ID
 * @returns Object with fromIndices and toIndex for the reorder operation
 */
export function calculateMultiDragReorder(
	items: string[],
	activeIds: string[],
	overId: string | null
): { fromIndices: number[]; toIndex: number } | null {
	if (!overId || activeIds.length === 0) {
		return null;
	}

	const overIndex = items.indexOf(overId);
	if (overIndex === -1) {
		return null;
	}

	// Get sorted indices of items being dragged
	const fromIndices = activeIds
		.map(id => items.indexOf(id))
		.filter(i => i !== -1)
		.sort((a, b) => a - b);

	if (fromIndices.length === 0) {
		return null;
	}

	return { fromIndices, toIndex: overIndex };
}
