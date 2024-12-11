/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './draggableTitleBar.css';

// React.
import React, { MouseEvent } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';

/**
 * DraggableTitleBarProps interface.
 */
interface DraggableTitleBarProps {
	title: string;
	onStartDrag: () => void;
	onDrag: (x: number, y: number) => void;
	onStopDrag: (x: number, y: number) => void;
}

/**
 * Event aliases.
 */
type DocumentMouseEvent = globalThis.MouseEvent;

/**
 * DraggableTitleBar component.
 * @param props A DraggableTitleBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const DraggableTitleBar = (props: DraggableTitleBarProps) => {
	// State hooks.
	const [, setDragState, dragStateRef] = useStateRef<{
		readonly body: HTMLElement;
		readonly startingX: number;
		readonly startingY: number;
	} | undefined>(undefined);

	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Get the document body on which the drag operation is happening.
		const body = DOM.getActiveWindow().document.body;

		// Set the drag state.
		setDragState({
			body,
			startingX: e.clientX,
			startingY: e.clientY
		});

		// Call the start drag callback.
		props.onStartDrag();

		// Mouse move handler.
		const mouseMoveHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Call the drag callback.
			props.onDrag(
				e.clientX - dragStateRef.current!.startingX,
				e.clientY - dragStateRef.current!.startingY
			);
		};

		// Mouse up handler.
		const mouseUpHandler = (e: DocumentMouseEvent) => {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Remove the drag event handlers.
			dragStateRef.current!.body.removeEventListener('mousemove', mouseMoveHandler);
			dragStateRef.current!.body.removeEventListener('mouseup', mouseUpHandler);

			// Call the stop drag callback.
			props.onStopDrag(
				e.clientX - dragStateRef.current!.startingX,
				e.clientY - dragStateRef.current!.startingY
			);

			// Clear the drag state.
			setDragState(undefined);
		};

		// Capture the mouse.
		body.addEventListener('mousemove', mouseMoveHandler, false);
		body.addEventListener('mouseup', mouseUpHandler, false);
	};

	// Render.
	return (
		<div className='simple-title-bar' onMouseDown={mouseDownHandler}>
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
