/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./simpleTitleBar';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * SimpleTitleBarProps interface.
 */
interface SimpleTitleBarProps {
	title: string;
	onMoveDialog?: (x: number, y: number) => void;
}

/**
 * Events.
 */
type DocumentMouseEvent = globalThis.MouseEvent;

/**
 * SimpleTitleBar component.
 * @param props A SimpleTitleBarProps that contains the properties for the component.
 */
export const SimpleTitleBar = (props: SimpleTitleBarProps) => {
	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		if (props.onMoveDialog) {
			// Setup handling.
			e.preventDefault();
			let clientX = e.clientX;
			let clientY = e.clientY;

			// Mouse move handler.
			const mouseMoveHandler = (e: DocumentMouseEvent) => {
				e.preventDefault();
				if (props.onMoveDialog) {
					e.preventDefault();
					props.onMoveDialog(clientX - e.clientX, clientY - e.clientY);
					clientX = e.clientX;
					clientY = e.clientY;
				}
			};

			// Mouse up handler.
			const mouseUpHandler = (e: DocumentMouseEvent) => {
				document.removeEventListener('mousemove', mouseMoveHandler);
				document.removeEventListener('mouseup', mouseUpHandler);
			};

			// Add our event handlers.
			document.addEventListener('mousemove', mouseMoveHandler, false);
			document.addEventListener('mouseup', mouseUpHandler, false);
		}
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
