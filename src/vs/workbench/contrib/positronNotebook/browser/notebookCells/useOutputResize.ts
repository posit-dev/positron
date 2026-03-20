/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useRef, useState, type RefObject } from 'react';

/** Minimum height the output container can be resized to (in pixels). */
const MIN_HEIGHT = 50;

/**
 * Hook that enables vertical resizing of a scrollable output container via a
 * drag handle. Returns:
 * - `handleRef`: callback ref to attach to the drag handle element
 * - `heightOverride`: the current user-set height (undefined = use default)
 * - `clearHeightOverride`: resets to default sizing
 */
export function useOutputResize(
	scrollContainerRef: RefObject<HTMLElement | null>,
): {
	handleRef: (el: HTMLElement | null) => (() => void) | void;
	heightOverride: number | undefined;
	clearHeightOverride: () => void;
} {
	const [heightOverride, setHeightOverride] = useState<number | undefined>(undefined);
	const dragging = useRef(false);
	const startY = useRef(0);
	const startHeight = useRef(0);

	const clearHeightOverride = useCallback(() => setHeightOverride(undefined), []);

	const handleRef = useCallback((handle: HTMLElement | null) => {
		if (!handle) {
			return;
		}

		const onMouseDown = (e: MouseEvent) => {
			e.preventDefault();
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}

			dragging.current = true;
			startY.current = e.clientY;
			startHeight.current = container.offsetHeight;

			document.body.style.cursor = 'ns-resize';
			// Prevent text selection while dragging
			document.body.style.userSelect = 'none';

			const onMouseMove = (moveEvent: MouseEvent) => {
				if (!dragging.current) {
					return;
				}
				const delta = moveEvent.clientY - startY.current;
				const newHeight = Math.max(MIN_HEIGHT, startHeight.current + delta);
				setHeightOverride(newHeight);
			};

			const onMouseUp = () => {
				dragging.current = false;
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
			};

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		};

		handle.addEventListener('mousedown', onMouseDown);
		return () => handle.removeEventListener('mousedown', onMouseDown);
	}, [scrollContainerRef]);

	return { handleRef, heightOverride, clearHeightOverride };
}
