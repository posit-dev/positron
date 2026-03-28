/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { useCallback, useRef, useState, type RefObject } from 'react';

/** Axis to resize along. */
export type ResizeAxis = 'vertical' | 'horizontal';

/** Which edge the drag handle sits on. `start` = top/left, `end` = bottom/right. */
export type ResizeEdge = 'start' | 'end';

interface UseResizeOptions {
	/** Axis to resize along. */
	axis: ResizeAxis;
	/** Which edge the drag handle sits on. */
	edge: ResizeEdge;
	/** Ref to the container whose size is being controlled. */
	containerRef: RefObject<HTMLElement | null>;
	/** Minimum size in pixels (default 50). */
	minSize?: number;
}

export interface UseResizeResult {
	/** Callback ref to attach to the drag handle element. */
	handleRef: (el: HTMLElement | null) => (() => void) | void;
	/** The current user-set size in pixels, or undefined for default sizing. */
	sizeOverride: number | undefined;
	/** Resets to default sizing. */
	clearSizeOverride: () => void;
}

/**
 * Generic hook for resizing an element via a drag handle.
 */
export function useResize({ axis, edge, containerRef, minSize = 50 }: UseResizeOptions): UseResizeResult {
	const [sizeOverride, setSizeOverride] = useState<number | undefined>(undefined);
	const dragging = useRef(false);
	const startPos = useRef(0);
	const startSize = useRef(0);

	const clearSizeOverride = useCallback(() => setSizeOverride(undefined), []);

	const handleRef = useCallback((handle: HTMLElement | null) => {
		if (!handle) {
			return;
		}

		const vertical = axis === 'vertical';
		const targetWindow = getWindow(handle);

		const onMouseDown = (e: MouseEvent) => {
			e.preventDefault();
			const container = containerRef.current;
			if (!container) {
				return;
			}

			dragging.current = true;
			startPos.current = vertical ? e.clientY : e.clientX;
			startSize.current = vertical ? container.offsetHeight : container.offsetWidth;

			targetWindow.document.body.style.cursor = vertical ? 'ns-resize' : 'ew-resize';
			targetWindow.document.body.style.userSelect = 'none';

			const onMouseMove = (moveEvent: MouseEvent) => {
				if (!dragging.current) {
					return;
				}
				const current = vertical ? moveEvent.clientY : moveEvent.clientX;
				const delta = current - startPos.current;
				// start edge (top/left handle): dragging up/left grows the element
				// end edge (bottom/right handle): dragging down/right grows the element
				const sign = edge === 'start' ? -1 : 1;
				const newSize = Math.max(minSize, startSize.current + sign * delta);
				setSizeOverride(newSize);
			};

			const onMouseUp = () => {
				dragging.current = false;
				targetWindow.document.body.style.cursor = '';
				targetWindow.document.body.style.userSelect = '';
				targetWindow.document.removeEventListener('mousemove', onMouseMove);
				targetWindow.document.removeEventListener('mouseup', onMouseUp);
			};

			targetWindow.document.addEventListener('mousemove', onMouseMove);
			targetWindow.document.addEventListener('mouseup', onMouseUp);
		};

		handle.addEventListener('mousedown', onMouseDown);
		return () => handle.removeEventListener('mousedown', onMouseDown);
	}, [containerRef, axis, edge, minSize]);

	return { handleRef, sizeOverride, clearSizeOverride };
}
