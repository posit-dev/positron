/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDndContext } from './DndContext.js';

interface UseDroppableProps {
	id: string;
}

export function useDroppable({ id }: UseDroppableProps) {
	const { state, registerDroppable, unregisterDroppable } = useDndContext();
	const nodeRef = React.useRef<HTMLElement | null>(null);

	const isOver = state.overId === id;

	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		if (nodeRef.current) {
			unregisterDroppable(id);
		}
		nodeRef.current = node;
		if (node) {
			registerDroppable(id, node);
		}
	}, [id, registerDroppable, unregisterDroppable]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			unregisterDroppable(id);
		};
	}, [id, unregisterDroppable]);

	return {
		setNodeRef,
		isOver,
	};
}
