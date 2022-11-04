/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { SimpleTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/simpleTitleBar';

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
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the modal dialog component properties.
 */
export const PositronModalDialog = (props: PropsWithChildren<PositronModalDialogProps>) => {
	// Hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// Memoize the keydown event handler.
	const keydownHandler = useCallback((event: DocumentKeyboardEvent) => {
		// Fully suppresses an event.
		const suppressEvent = () => {
			event.preventDefault();
			event.stopPropagation();
		};

		// Handle the event.
		switch (event.key) {
			case 'Enter':
				suppressEvent();
				props.accept?.();
				break;
			case 'Escape':
				suppressEvent();
				props.cancel?.();
				break;
		}
	}, []);

	// Add the keydown event listener.
	useEffect(() => {
		const KEYDOWN = 'keydown';
		document.addEventListener(KEYDOWN, keydownHandler, false);
		return () => {
			document.removeEventListener(KEYDOWN, keydownHandler, false);
		};
	}, []);

	const moveHandler = (x: number, y: number) => {
		console.log(`Move was called ${x},${y}`);

		ref.current.style.setProperty('left', `${ref.current.offsetLeft - x}px`);
		ref.current.style.setProperty('top', `${ref.current.offsetTop - y}px`);

		// set the element's new position:
		// elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
		// elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
	};

	// Render.
	return (
		<div className='positron-modal-dialog-shadow-container'>
			<div className='positron-modal-dialog-container' role='dialog' tabIndex={-1}>
				<div ref={ref} className='positron-modal-dialog-box' style={{ width: props.width, height: props.height }}>
					{props.title && <SimpleTitleBar {...props} move={moveHandler} />}
					{props.children}
				</div>
			</div>
		</div>
	);
};
