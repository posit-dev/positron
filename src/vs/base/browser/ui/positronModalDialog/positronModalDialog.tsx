/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DraggableTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/draggableTitleBar';

/**
 * The gutter where the dialog box cannot be moved.
 */
const kGutter = 40;

/**
 * Event aliases.
 */
type UIEvent = globalThis.UIEvent;
type KeyboardEvent = globalThis.KeyboardEvent;

/**
 * PositronModalDialogProps interface.
 */
export interface PositronModalDialogProps {
	title: string;
	width: number;
	height: number;
	accept?: () => void;
	cancel?: () => void;
}

/**
 * DialogBoxState interface.
 */
interface DialogBoxState {
	dragging: boolean;
	dragOffsetLeft: number;
	dragOffsetTop: number;
	left: number;
	top: number;
}

/**
 * The initial dialog box state.
 */
const kInitialDialogBoxState: DialogBoxState = {
	dragging: false,
	dragOffsetLeft: 0,
	dragOffsetTop: 0,
	left: 0,
	top: 0
};

/**
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the modal dialog component properties.
 */
export const PositronModalDialog = (props: PropsWithChildren<PositronModalDialogProps>) => {
	// Hooks.
	const dialogContainerRef = useRef<HTMLDivElement>(undefined!);
	const dialogBoxRef = useRef<HTMLDivElement>(undefined!);
	const [dialogBoxState, setDialogBoxState] = useState(kInitialDialogBoxState);

	// Memoize the keydown event handler.
	const keydownHandler = useCallback((e: KeyboardEvent) => {
		// Handle the event.
		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				e.stopPropagation();
				props.accept?.();
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				props.cancel?.();
				break;
		}
	}, []);

	// Memoize the resizeHandler.
	const resizeHandler = useCallback((e: UIEvent) => {
		// Update the dialog box state.
		setDialogBoxState(prevDialogBoxState => {
			// Set the left and top.
			let left = prevDialogBoxState.left;
			let top = prevDialogBoxState.top;

			// If the left position places the dialog box off the screen to the right, move the dialog box left to keep it on screen.
			if (left + props.width > dialogContainerRef.current.clientWidth) {
				left = Math.max(dialogContainerRef.current.clientWidth - props.width - kGutter, kGutter);
			}

			// If the top position places the dialog box off the screen to the bottom, move the dialog box up to keep it on screen.
			if (top + props.height > dialogContainerRef.current.clientHeight) {
				top = Math.max(dialogContainerRef.current.clientHeight - props.height - kGutter, kGutter);
			}

			// Update the dialog box state.
			const result: DialogBoxState = {
				...prevDialogBoxState,
				left,
				top
			};
			return result;
		});
	}, []);

	// Initialization.
	useEffect(() => {
		// Center the dialog.
		setDialogBoxState(prevDialogBoxState => {
			const result: DialogBoxState = {
				...prevDialogBoxState,
				left: Math.max(dialogContainerRef.current.clientWidth / 2 - props.width / 2, kGutter),
				top: Math.max(dialogContainerRef.current.clientHeight / 2 - props.height / 2, kGutter),
			};
			return result;
		});

		// Add our event handlers.
		const KEYDOWN = 'keydown';
		const RESIZE = 'resize';
		document.addEventListener(KEYDOWN, keydownHandler, false);
		window.addEventListener(RESIZE, resizeHandler, false);

		// Return the cleanup function that removes our event handlers.
		return () => {
			document.addEventListener(KEYDOWN, keydownHandler, false);
			window.removeEventListener(RESIZE, resizeHandler, false);
		};
	}, []);

	// Start drag handler.
	const startDragHandler = () => {
		// Update the dialog box state.
		setDialogBoxState(prevDialogBoxState => {
			// If the dialog box cannot be moved because it is pinned at the left or pinned at the top,
			// do not enter dragging mode.
			if (prevDialogBoxState.left + props.width >= dialogContainerRef.current.clientWidth ||
				prevDialogBoxState.top + props.height >= dialogContainerRef.current.clientHeight) {
				return prevDialogBoxState;
			}

			// Update the dialog box state, entering dragging mode and recording the drag offsets.
			const result: DialogBoxState = {
				...prevDialogBoxState,
				dragging: true,
				dragOffsetLeft: dialogBoxRef.current.offsetLeft,
				dragOffsetTop: dialogBoxRef.current.offsetTop
			};

			// Return the dialog box state.
			return result;
		});
	};

	/**
	 * Updates the dialog box state.
	 * @param prevDialogBoxState The previous dialog box state.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 * @param dragging A value which indicates whether to continue dragging.
	 * @returns The updated dialog box state.
	 */
	const updateDialogBoxState = (prevDialogBoxState: DialogBoxState, x: number, y: number, dragging: boolean): DialogBoxState => {
		// If we are not in dragging mode, do nothing.
		if (!prevDialogBoxState.dragging) {
			return prevDialogBoxState;
		}

		// Compute the left and top values.
		const left = Math.min(Math.max(prevDialogBoxState.dragOffsetLeft + x, kGutter), dialogContainerRef.current.clientWidth - props.width - kGutter);
		const top = Math.min(Math.max(prevDialogBoxState.dragOffsetTop + y, kGutter), dialogContainerRef.current.clientHeight - props.height - kGutter);

		// Update the dialog box state.
		const result: DialogBoxState = { ...prevDialogBoxState, dragging, left, top };

		// Return the updated dialog box state.
		return result;
	};

	/**
	 * The drag handler.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 */
	const dragHandler = (x: number, y: number) => {
		setDialogBoxState(prevDialogBoxState => updateDialogBoxState(prevDialogBoxState, x, y, true));
	};

	/**
	 * The stop drag handler.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 */
	const stopDragHandler = (x: number, y: number) => {
		setDialogBoxState(prevDialogBoxState => updateDialogBoxState(prevDialogBoxState, x, y, false));
	};

	// Render.
	return (
		<div className='positron-modal-dialog-shadow-container'>
			<div ref={dialogContainerRef} className='positron-modal-dialog-container' role='dialog' tabIndex={-1}>
				<div ref={dialogBoxRef} className='positron-modal-dialog-box' style={{ left: dialogBoxState.left, top: dialogBoxState.top, width: props.width, height: props.height }}>
					<DraggableTitleBar {...props} onStartDrag={startDragHandler} onDrag={dragHandler} onStopDrag={stopDragHandler} />
					{props.children}
				</div>
			</div>
		</div>
	);
};
