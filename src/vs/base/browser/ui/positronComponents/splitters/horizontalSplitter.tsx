/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./horizontalSplitter';

// React.
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { isMacintosh } from 'vs/base/common/platform';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * HorizontalSplitterResizeParams interface. This defines the parameters of a resize operation. When
 * invert is true, the mouse delta is subtracted from the starting height instead of being added to
 * it, which inverts the resize operation.
 */
export interface HorizontalSplitterResizeParams {
	minimumHeight: number;
	maximumHeight: number;
	startingHeight: number;
	invert?: boolean;
}

/**
 * HorizontalSplitter component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const HorizontalSplitter = (props: {
	showResizeIndicator?: boolean;
	onBeginResize: () => HorizontalSplitterResizeParams;
	onResize: (height: number) => void;
}) => {
	// State hooks.
	const [resizing, setResizing] = useState(false);

	/**
	 * onPointerDown handler.
	 * @param e A PointerEvent that describes a user interaction with the pointer.
	 */
	const pointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
		// Ignore events we don't process.
		if (e.pointerType === 'mouse' && e.buttons !== 1) {
			return;
		}

		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Setup the resize state.
		const resizeParams = props.onBeginResize();
		const target = DOM.getWindow(e.currentTarget).document.body;
		const clientY = e.clientY;
		const styleSheet = DOM.createStyleSheet(target);

		/**
		 * pointermove event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const pointerMoveHandler = (e: PointerEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Calculate the new height.
			let newHeight = calculateNewHeight(e);

			// Adjust the new height to be within limits and set the cursor accordingly.
			let cursor: string;
			if (newHeight < resizeParams.minimumHeight) {
				cursor = 's-resize';
				newHeight = resizeParams.minimumHeight;
			} else if (newHeight > resizeParams.maximumHeight) {
				cursor = 'n-resize';
				newHeight = resizeParams.maximumHeight;
			} else {
				cursor = isMacintosh ? 'row-resize' : 'ns-resize';
			}

			// Update the style sheet's text content with the desired cursor. This is a clever
			// technique adopted from src/vs/base/browser/ui/sash/sash.ts.
			styleSheet.textContent = `* { cursor: ${cursor} !important; }`;

			// Call the onResize callback.
			props.onResize(newHeight);
		};

		/**
		 * lostpointercapture event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const lostPointerCaptureHandler = (e: PointerEvent) => {
			// Clear the dragging flag.
			setResizing(false);

			// Remove our pointer event handlers.
			target.removeEventListener('pointermove', pointerMoveHandler);
			target.removeEventListener('lostpointercapture', lostPointerCaptureHandler);

			// Calculate the new height.
			let newHeight = calculateNewHeight(e);

			// Adjust the new height to be within limits.
			if (newHeight < resizeParams.minimumHeight) {
				newHeight = resizeParams.minimumHeight;
			} else if (newHeight > resizeParams.maximumHeight) {
				newHeight = resizeParams.maximumHeight;
			}

			// Remove the style sheet.
			target.removeChild(styleSheet);

			// Call the onEndResize callback.
			props.onResize(newHeight);
		};

		/**
		 * Calculates the new height based on a GlobalPointerEvent.
		 * @param e The GlobalPointerEvent.
		 * @returns The new height.
		 */
		const calculateNewHeight = (e: PointerEvent) => {
			// Calculate the delta.
			const delta = Math.trunc(e.clientY - clientY);

			// Calculate the new height.
			return !resizeParams.invert ?
				resizeParams.startingHeight + delta :
				resizeParams.startingHeight - delta;
		};

		// Set the dragging flag.
		setResizing(true);

		// Set the capture target of future pointer events to be the current target and add our
		// pointer event handlers.
		target.setPointerCapture(e.pointerId);
		target.addEventListener('pointermove', pointerMoveHandler);
		target.addEventListener('lostpointercapture', lostPointerCaptureHandler);
	};

	// Render.
	return (
		<div className='horizontal-splitter'>
			<div
				className={positronClassNames(
					'sizer',
					{ 'resizing': resizing && props.showResizeIndicator }
				)}
				onPointerDown={pointerDownHandler}
			/>
		</div>
	);
};
