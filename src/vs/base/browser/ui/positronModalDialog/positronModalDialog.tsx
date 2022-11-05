/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { MoveDialogEvent, TitleBar } from 'vs/base/browser/ui/positronModalDialog/components/titleBar';

const kBorderWidth = 40;

/**
 * Events.
 */
type DocumentKeyboardEvent = globalThis.KeyboardEvent;

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
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the modal dialog component properties.
 */
export const PositronModalDialog = (props: PropsWithChildren<PositronModalDialogProps>) => {
	// Hooks.
	const dialogContainerRef = useRef<HTMLDivElement>(undefined!);
	const dialogBoxRef = useRef<HTMLDivElement>(undefined!);
	const [dialogBoxState, setDialogBoxState] = useState<DialogBoxState>({
		dragging: false,
		dragOffsetLeft: 0,
		dragOffsetTop: 0,
		left: 100,
		top: 100
	});

	// Memoize the resizeHandler.
	const resizeHandler = useCallback((e: globalThis.UIEvent) => {
		console.log(`resizeHandler called`);
		setDialogBoxState(prevDialogBoxState => {
			const result: DialogBoxState = {
				...prevDialogBoxState,
				left: Math.max(dialogContainerRef.current.clientWidth / 2 - props.width / 2, kBorderWidth),
				top: Math.max(dialogContainerRef.current.clientHeight / 2 - props.height / 2, kBorderWidth),
			};
			return result;
		});
	}, []);

	// Memoize the keydown event handler.
	const keydownHandler = useCallback((e: DocumentKeyboardEvent) => {
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

	// Add the keydown event listener.
	useEffect(() => {
		const KEYDOWN = 'keydown';
		const RESIZE = 'resize';
		document.addEventListener(KEYDOWN, keydownHandler, false);
		document.addEventListener(RESIZE, resizeHandler, false);
		return () => {
			document.addEventListener(KEYDOWN, keydownHandler, false);
			document.removeEventListener(RESIZE, resizeHandler, false);
		};
	}, []);

	useEffect(() => {
		setDialogBoxState(prevDialogBoxState => {
			const result: DialogBoxState = {
				...prevDialogBoxState,
				left: Math.max(dialogContainerRef.current.clientWidth / 2 - props.width / 2, kBorderWidth),
				top: Math.max(dialogContainerRef.current.clientHeight / 2 - props.height / 2, kBorderWidth),
			};
			return result;
		});
	}, []);

	const moveDialogHandler = (moveDialogEvent: MoveDialogEvent, x: number, y: number) => {
		switch (moveDialogEvent) {
			case MoveDialogEvent.Start:
				setDialogBoxState(prevDialogBoxState => {
					const result: DialogBoxState = {
						...prevDialogBoxState,
						dragging: true,
						dragOffsetLeft: dialogBoxRef.current.offsetLeft,
						dragOffsetTop: dialogBoxRef.current.offsetTop
					};
					return result;
				});
				break;
			case MoveDialogEvent.Move:
				setDialogBoxState(prevDialogBoxState => {
					const result: DialogBoxState = {
						...prevDialogBoxState,
						left: Math.min(Math.max(prevDialogBoxState.dragOffsetLeft + x, kBorderWidth), dialogContainerRef.current.clientWidth - props.width - 20),
						top: Math.min(Math.max(prevDialogBoxState.dragOffsetTop + y, kBorderWidth), dialogContainerRef.current.clientHeight - props.height - 20)
					};
					return result;
				});
				break;
			case MoveDialogEvent.Stop:
				setDialogBoxState(prevDialogBoxState => {
					const result: DialogBoxState = {
						...prevDialogBoxState,
						dragging: false,
					};
					return result;
				});
				break;
		}
	};

	// Render.
	return (
		<div className='positron-modal-dialog-shadow-container'>
			<div ref={dialogContainerRef} className='positron-modal-dialog-container' role='dialog' tabIndex={-1}>
				<div ref={dialogBoxRef} className='positron-modal-dialog-box' style={{ left: dialogBoxState.left, top: dialogBoxState.top, width: props.width, height: props.height }}>
					<TitleBar {...props} onMoveDialog={moveDialogHandler} />
					{props.children}
				</div>
			</div>
		</div>
	);
};
