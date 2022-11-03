/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * Events.
 */
type DocumentKeyboardEvent = globalThis.KeyboardEvent;

/**
 * PositronModalDialogProps interface.
 */
export interface PositronModalDialogProps {
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

	// Render.
	return (
		<div className='positron-modal-dialog-shadow-container'>
			<div className='positron-modal-dialog-container' role='dialog' tabIndex={-1}>
				<div className='positron-modal-dialog-box' style={{ width: props.width, height: props.height }}>
					{props.children}
				</div>
			</div>
		</div>
	);
};
