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
 * PositronColumnSplitterResizeParams interface. This defines the parameters of a resize operation.
 * When invert is true, the mouse delta is subtracted from the starting width instead of being added
 * to it, which inverts the resize operation.
 */
export interface PositronColumnSplitterResizeParams {
	minimumWidth: number;
	maximumWidth: number;
	startingWidth: number;
	invert?: boolean;
}

/**
 * PositronColumnSplitterResizeState interface. This defines the state of a resize operation that is
 * underway.
 */
interface PositronColumnSplitterResizeState extends PositronColumnSplitterResizeParams {
	readonly body: HTMLElement;
	readonly startingX: number;
	readonly stylesheet: HTMLStyleElement;
}

/**
 * PositronColumnSplitterProps interface.
 */
interface PositronColumnSplitterProps {
	width: number;
	showSizer?: boolean;
	onBeginResize: () => PositronColumnSplitterResizeParams;
	onResize: (width: number) => void;
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
	const [, setResizeState, resizeStateRef] =
		useStateRef<PositronColumnSplitterResizeState | undefined>(undefined);

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
			...props.onBeginResize(),
			body,
			startingX: e.clientX,
			stylesheet: DOM.createStyleSheet(body)
		});

		// Mouse move handler.
		const mouseMoveHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Calculate the new width.
			let newWidth = calculateNewWidth(e);

			// Adjust the new width to be within limits and set the cursor accordingly.
			let cursor: string;
			if (newWidth < resizeStateRef.current!.minimumWidth) {
				cursor = 'e-resize';
				newWidth = resizeStateRef.current!.minimumWidth;
			} else if (newWidth > resizeStateRef.current!.maximumWidth) {
				cursor = 'w-resize';
				newWidth = resizeStateRef.current!.maximumWidth;
			} else {
				cursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}

			// Update the style sheet's text content with the desired cursor. This is a clever
			// technique adopted from src/vs/base/browser/ui/sash/sash.ts.
			resizeStateRef.current!.stylesheet.textContent = `* { cursor: ${cursor} !important; }`;

			// Call the onResize callback.
			props.onResize(newWidth);
		};

		// Mouse up handler.
		const mouseUpHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Remove the drag event handlers.
			resizeStateRef.current!.body.removeEventListener('mousemove', mouseMoveHandler);
			resizeStateRef.current!.body.removeEventListener('mouseup', mouseUpHandler);

			// Calculate the new width.
			let newWidth = calculateNewWidth(e);

			// Adjust the new width to be within limits.
			if (newWidth < resizeStateRef.current!.minimumWidth) {
				newWidth = resizeStateRef.current!.minimumWidth;
			} else if (newWidth > resizeStateRef.current!.maximumWidth) {
				newWidth = resizeStateRef.current!.maximumWidth;
			}

			// Remove the style sheet.
			resizeStateRef.current!.body.removeChild(resizeStateRef.current!.stylesheet);

			// Call the onResize callback for the final time so any mouse movement is captured.
			props.onResize(newWidth);

			// Clear the resize state.
			setResizeState(undefined);
		};

		/**
		 * Calculates the new width based on a DocumentMouseEvent.
		 * @param e The DocumentMouseEvent.
		 * @returns The new width.
		 */
		const calculateNewWidth = (e: DocumentMouseEvent) => {
			// Calculate the delta.
			const delta = e.clientX - resizeStateRef.current!.startingX;

			// Calculate the new width.
			return !resizeStateRef.current!.invert ?
				resizeStateRef.current!.startingWidth + delta :
				resizeStateRef.current!.startingWidth - delta;
		};

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
