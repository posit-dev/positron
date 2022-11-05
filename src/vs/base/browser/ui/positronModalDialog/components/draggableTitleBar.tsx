/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./draggableTitleBar';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

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
 * @param props A DraggableTitleBarProps that contains the properties for the component.
 */
export const DraggableTitleBar = (props: DraggableTitleBarProps) => {
	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		// Eat the event.
		e.preventDefault();
		e.stopPropagation();

		// Set the starting X an starting Y.
		const startingX = e.clientX;
		const startingY = e.clientY;

		// Call the start drag callback.
		props.onStartDrag();

		// Mouse move handler.
		const mouseMoveHandler = (e: DocumentMouseEvent) => {
			// Eat the event.
			e.preventDefault();
			e.stopPropagation();

			// Call the drag callback.
			props.onDrag(e.clientX - startingX, e.clientY - startingY);
		};

		// Mouse up handler.
		const mouseUpHandler = (e: DocumentMouseEvent) => {
			// Eat the event.
			e.preventDefault();
			e.stopPropagation();

			// Remove the drag event handlers.
			document.removeEventListener('mousemove', mouseMoveHandler);
			document.removeEventListener('mouseup', mouseUpHandler);

			// Call the stop drag callback.
			props.onStopDrag(e.clientX - startingX, e.clientY - startingY);
		};

		// Add the drag event handlers.
		document.addEventListener('mousemove', mouseMoveHandler, false);
		document.addEventListener('mouseup', mouseUpHandler, false);
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
