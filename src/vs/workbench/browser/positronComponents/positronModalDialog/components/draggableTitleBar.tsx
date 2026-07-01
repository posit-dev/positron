/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './draggableTitleBar.css';

// React.
import { MouseEvent } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * DraggableTitleBarProps interface.
 */
interface DraggableTitleBarProps {
	title: string;
	onStartDrag: () => void;
	onDrag: (x: number, y: number) => void;
	onStopDrag: (x: number, y: number) => void;

	// When provided, a close (X) button is shown at the right of the title bar that invokes this
	// handler, giving the dialog a click-to-close affordance in addition to the Escape key.
	onClose?: () => void;
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
		// The title bar is a structural element whose drag behavior is mouse-only and doesn't need
		// keyboard semantics (the dialog handles Escape/Tab/Enter at a higher level).
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div className='simple-title-bar' onMouseDown={mouseDownHandler}>
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
			{props.onClose &&
				<Button
					ariaLabel={localize('positron.modalDialog.close', "Close")}
					className='simple-title-bar-close-button'
					onPressed={props.onClose}
				>
					<div className='codicon codicon-close' />
				</Button>
			}
		</div>
	);
};
