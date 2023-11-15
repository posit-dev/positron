/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnSplitter';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * ColumnSplitterProps interface.
 */
interface ColumnSplitterProps {
	onStartResize: () => void;
	onResize: (x: number, y: number) => void;
	onStopResize: (x: number, y: number) => void;
}

/**
 * Event aliases.
 */
type DocumentMouseEvent = globalThis.MouseEvent;

/**
 * ColumnSplitter component.
 * @param props A ColumnSplitterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSplitter = (props: ColumnSplitterProps) => {
	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		// Eat the event.
		e.preventDefault();
		e.stopPropagation();

		// Set the starting X an starting Y.
		const startingX = e.clientX;
		const startingY = e.clientY;

		// Call the start resize callback.
		props.onStartResize();

		// Mouse move handler.
		const mouseMoveHandler = (e: DocumentMouseEvent) => {
			// Eat the event.
			e.preventDefault();
			e.stopPropagation();

			// Call the resize callback.
			props.onResize(e.clientX - startingX, e.clientY - startingY);
		};

		// Mouse up handler.
		const mouseUpHandler = (e: DocumentMouseEvent) => {
			// Eat the event.
			e.preventDefault();
			e.stopPropagation();

			// Remove the drag event handlers.
			document.removeEventListener('mousemove', mouseMoveHandler);
			document.removeEventListener('mouseup', mouseUpHandler);

			// Call the stop resize callback.
			props.onStopResize(e.clientX - startingX, e.clientY - startingY);
		};

		// Add the drag event handlers.
		document.addEventListener('mousemove', mouseMoveHandler, false);
		document.addEventListener('mouseup', mouseUpHandler, false);
	};

	// Render.
	return (
		<div className='column-splitter' onMouseDown={mouseDownHandler}>
			<div className='sizer' />
		</div>
	);
};
