/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./titleBar';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * MoveDialogEvent enumeration.
 */
export enum MoveDialogEvent {
	Start,
	Move,
	Stop
}

/**
 * TitleBarProps interface.
 */
interface TitleBarProps {
	title: string;
	onMoveDialog?: (event: MoveDialogEvent, deltaX: number, deltaY: number) => void;
}

/**
 * Events.
 */
type DocumentMouseEvent = globalThis.MouseEvent;

/**
 * TitleBar component.
 * @param props A TitleBarProps that contains the properties for the component.
 */
export const TitleBar = (props: TitleBarProps) => {
	// Mouse down handler.
	const mouseDownHandler = (e: MouseEvent) => {
		if (props.onMoveDialog) {
			e.preventDefault();
			e.stopPropagation();
			const startingX = e.clientX;
			const startingY = e.clientY;
			props.onMoveDialog(MoveDialogEvent.Start, 0, 0);

			// Mouse move handler.
			const mouseMoveHandler = (e: DocumentMouseEvent) => {
				if (props.onMoveDialog) {
					e.preventDefault();
					e.stopPropagation();
					props.onMoveDialog(MoveDialogEvent.Move, e.clientX - startingX, e.clientY - startingY);
				}
			};

			// Mouse up handler.
			const mouseUpHandler = (e: DocumentMouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				document.removeEventListener('mousemove', mouseMoveHandler);
				document.removeEventListener('mouseup', mouseUpHandler);
				props.onMoveDialog?.(MoveDialogEvent.Stop, e.clientX - startingX, e.clientY - startingY);
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
