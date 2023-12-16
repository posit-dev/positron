/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronColumnSplitter';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import * as DOM from 'vs/base/browser/dom';
import { isMacintosh } from 'vs/base/common/platform';

/**
 * PositronColumnSplitterResizeResult enumeration.
 */
export enum PositronColumnSplitterResizeResult {
	Resizing = 'Resizing',
	TooSmall = 'TooSmall',
	TooLarge = 'TooLarge'
}

/**
 * PositronColumnSplitterProps interface.
 */
interface PositronColumnSplitterProps {
	width: number;
	showSizer?: boolean;
	onResize: (x: number, y: number) => PositronColumnSplitterResizeResult;
}

/**
 * Event aliases.
 */
type DocumentMouseEvent = globalThis.MouseEvent;

/**
 * PositronColumnSplitter component.
 * @param props A PositronColumnSplitterProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronColumnSplitter = (props: PositronColumnSplitterProps) => {
	// State hooks.
	const [, setResizeState, resizeStateRef] = useStateRef<{
		readonly body: HTMLElement;
		readonly startingX: number;
		readonly startingY: number;
		readonly stylesheet: HTMLStyleElement;
	} | undefined>(undefined);

	/**
	 * MouseDown handler.
	 * @param e A MouseEvent hat describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Get the document body on which the resize operation is happening.
		const body = DOM.getActiveWindow().document.body;

		// Set the resize state.
		setResizeState({
			body,
			startingX: e.clientX,
			startingY: e.clientY,
			stylesheet: DOM.createStyleSheet(body)
		});

		// Mouse move handler.
		const mouseMoveHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Fire onResize.
			updateStyleSheet(fireOnResize(e));
		};

		// Mouse up handler.
		const mouseUpHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Remove the drag event handlers.
			resizeStateRef.current!.body.removeEventListener('mousemove', mouseMoveHandler);
			resizeStateRef.current!.body.removeEventListener('mouseup', mouseUpHandler);

			// Fire onResize one last time.
			fireOnResize(e);

			// Remove the style sheet.
			resizeStateRef.current!.body.removeChild(resizeStateRef.current!.stylesheet);

			// Clear the resize state.
			setResizeState(undefined);
		};

		/**
		 * Updates the style sheet based on the column splitter resize result.
		 * @param columnSplitterResizeResult The column splitter resize result.
		 */
		const updateStyleSheet = (columnSplitterResizeResult: PositronColumnSplitterResizeResult) => {
			// Set the cursor.
			let cursor: string;
			switch (columnSplitterResizeResult) {
				// If the column is resizing (not too small and not too large), use the correct
				// resize cursor.
				case PositronColumnSplitterResizeResult.Resizing:
					cursor = isMacintosh ? 'col-resize' : 'ew-resize';
					break;

				// If the column is too small, use the e-resize cursor.
				case PositronColumnSplitterResizeResult.TooSmall:
					cursor = 'e-resize';
					break;

				// If the column is too large, use the w-resize cursor.
				case PositronColumnSplitterResizeResult.TooLarge:
					cursor = 'w-resize';
					break;
			}

			// Update the style sheet's text content with the desired cursor. This is a clever
			// technique adopted from src/vs/base/browser/ui/sash/sash.ts.
			resizeStateRef.current!.stylesheet.textContent = `* { cursor: ${cursor} !important; }`;
		};

		/**
		 * Fires onResize for a mouse event.
		 * @param e The mouse event.
		 */
		const fireOnResize = (e: DocumentMouseEvent): PositronColumnSplitterResizeResult =>
			props.onResize(
				e.clientX - resizeStateRef.current!.startingX,
				e.clientY - resizeStateRef.current!.startingY
			);

		// Capture the mouse.
		body.addEventListener('mousemove', mouseMoveHandler, false);
		body.addEventListener('mouseup', mouseUpHandler, false);
	};

	// Render.
	return (
		<div
			className='positron-column-splitter'
			onMouseDown={mouseDownHandler}
			style={{ width: props.width }}
		>
			{props.showSizer &&
				<div className='sizer' style={{ width: Math.trunc(props.width / 2) }} />
			}
		</div>
	);
};
