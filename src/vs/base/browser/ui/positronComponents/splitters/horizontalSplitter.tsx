/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './horizontalSplitter.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../dom.js';
import { Delayer } from '../../../../common/async.js';
import { isMacintosh } from '../../../../common/platform.js';
import { DisposableStore } from '../../../../common/lifecycle.js';
import { positronClassNames } from '../../../../common/positronUtilities.js';
import { createStyleSheet } from '../../../domStylesheets.js';
import { usePositronReactServicesContext } from '../../../positronReactRendererContext.js';
import { getHoverDelay, isPointInsideElement } from './verticalSplitter.js';

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
	onDoubleClick?: () => void;
}) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const hoverDelayerRef = useRef<Delayer<void>>(undefined);

	// State hooks.
	const [resizing, setResizing] = useState(false);
	const [hovering, setHovering] = useState(false);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposables = new DisposableStore();

		// Set the hover delayer.
		const hoverDelay = getHoverDelay(services.configurationService);
		hoverDelayerRef.current = disposables.add(new Delayer<void>(hoverDelay));

		// Add the onDidChangeConfiguration event handler.
		disposables.add(
			services.configurationService.onDidChangeConfiguration(e => {
				// Track changes to workbench.sash.hoverDelay.
				if (e.affectedKeys.has('workbench.sash.hoverDelay') && hoverDelayerRef.current) {
					hoverDelayerRef.current.defaultDelay = getHoverDelay(services.configurationService);
				}
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposables.dispose();
	}, [services.configurationService]);

	/**
	 * onPointerEnter handler.
	 */
	const pointerEnterHandler = () => {
		hoverDelayerRef.current?.trigger(() => setHovering(true));
	};

	/**
	 * onPointerLeave handler.
	 */
	const pointerLeaveHandler = () => {
		if (!resizing) {
			hoverDelayerRef.current?.cancel();
			setHovering(false);
		}
	};

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
		const sash = e.currentTarget;
		const body = DOM.getWindow(sash).document.body;
		const clientY = e.clientY;
		const styleSheet = createStyleSheet(body);

		// Track whether any meaningful drag occurred, so we can distinguish
		// a click (or double-click) from a drag on pointer release.
		let didDrag = false;

		/**
		 * pointermove event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const pointerMoveHandler = (e: PointerEvent) => {
			// The pointer moved, mark as dragging.
			didDrag = true;

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

			// Update the style sheet's text content with the desired cursor and
			// disable text selection during the resize operation. This is a clever
			// technique adopted from src/vs/base/browser/ui/sash/sash.ts.
			styleSheet.textContent = `* { cursor: ${cursor} !important; user-select: none !important; }`;

			// Call the onResize callback.
			props.onResize(newHeight);
		};

		/**
		 * lostpointercapture event handler.
		 * @param e A PointerEvent that describes a user interaction with the pointer.
		 */
		const lostPointerCaptureHandler = (e: PointerEvent) => {
			// Only commit the final height if the user actually dragged.
			// This avoids interfering with click and double-click interactions.
			if (didDrag) {
				// Handle the last possible move change.
				pointerMoveHandler(e);
			}

			// Remove our pointer event handlers.
			sash.removeEventListener('pointermove', pointerMoveHandler);
			sash.removeEventListener('lostpointercapture', lostPointerCaptureHandler);

			// Remove the style sheet.
			body.removeChild(styleSheet);

			// Clear the resizing flag.
			setResizing(false);
			hoverDelayerRef.current?.cancel();
			setHovering(isPointInsideElement(e.clientX, e.clientY, sash));
		};

		/**
		 * Calculates the new height based on a GlobalPointerEvent.
		 * @param e The GlobalPointerEvent.
		 * @returns The new height.
		 */
		const calculateNewHeight = (e: PointerEvent) => {
			// Calculate the delta.
			const delta = e.clientY - clientY;

			// Calculate the new height.
			return !resizeParams.invert ?
				resizeParams.startingHeight + delta :
				resizeParams.startingHeight - delta;
		};

		// Set the dragging flag and show hover indicator immediately.
		setResizing(true);
		hoverDelayerRef.current?.cancel();
		setHovering(true);

		// Set pointer capture on the sizer element and add our pointer event handlers.
		sash.setPointerCapture(e.pointerId);
		sash.addEventListener('pointermove', pointerMoveHandler);
		sash.addEventListener('lostpointercapture', lostPointerCaptureHandler);
	};

	/**
	 * onDoubleClick handler.
	 */
	const doubleClickHandler = () => {
		props.onDoubleClick?.();
		hoverDelayerRef.current?.cancel();
		setHovering(false);
	};

	// Render.
	return (
		<div className='horizontal-splitter'>
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
			<div
				className={positronClassNames(
					'sash',
					{ 'hovering': hovering && props.showResizeIndicator },
					{ 'resizing': resizing && props.showResizeIndicator }
				)}
				onDoubleClick={doubleClickHandler}
				onPointerDown={pointerDownHandler}
				onPointerEnter={pointerEnterHandler}
				onPointerLeave={pointerLeaveHandler}
			/>
		</div>
	);
};
