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

interface MultiDragContextValue {
	state: MultiDragState;
	selectedIds: string[];
	startMultiDrag: (primaryId: string, allSelectedIds: string[]) => void;
	updateMultiDrag: (overId: string | null) => void;
	endMultiDrag: () => void;
	cancelMultiDrag: () => void;
}

const MultiDragReactContext = React.createContext<MultiDragContextValue | null>(null);

interface MultiDragProviderProps {
	children: React.ReactNode;
	selectedIds: string[];
	onReorder?: (fromIndices: number[], toIndex: number) => void;
}

/**
 * Provider for multi-cell drag-and-drop functionality.
 * Works alongside the existing DndContext to enable dragging multiple selected cells.
 */
export function MultiDragProvider({
	children,
	selectedIds,
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

	const startMultiDrag = React.useCallback((primaryId: string, allSelectedIds: string[]) => {
		// If the primary drag item is in the selection, drag all selected items
		// Otherwise, only drag the single item
		const idsToMove = allSelectedIds.includes(primaryId)
			? allSelectedIds
			: [primaryId];

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
		setState({
			activeIds: [],
			overId: null,
			isDragging: false,
		});
	}, []);

	const cancelMultiDrag = React.useCallback(() => {
		setState({
			activeIds: [],
			overId: null,
			isDragging: false,
		});
	}, []);

	const value = React.useMemo(
		() => ({
			state,
			selectedIds,
			startMultiDrag,
			updateMultiDrag,
			endMultiDrag,
			cancelMultiDrag,
		}),
		[state, selectedIds, startMultiDrag, updateMultiDrag, endMultiDrag, cancelMultiDrag]
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
 * Hook for determining if an item is part of a multi-drag operation.
 * Returns null if multi-drag context is not available.
 */
export function useMultiDragState(itemId: string) {
	const context = React.useContext(MultiDragReactContext);

	if (!context) {
		return null;
	}

	const { state, selectedIds } = context;
	const isSelected = selectedIds.includes(itemId);
	const isBeingDragged = state.activeIds.includes(itemId);
	const isPrimaryDrag = state.activeIds[0] === itemId;
	const dragCount = state.activeIds.length;

	return {
		isSelected,
		isBeingDragged,
		isPrimaryDrag,
		dragCount,
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
