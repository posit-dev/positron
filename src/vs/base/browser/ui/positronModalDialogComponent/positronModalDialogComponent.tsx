/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialogComponent';
const React = require('react');
import { useCallback, useEffect } from 'react';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

/**
 * PositronModalDialogComponentProps interface.
 */
export interface PositronModalDialogComponentProps {
	width: number;
	height: number;
	enter?: () => void;
	escape?: () => void;
}

/**
 * PositronModalDialogComponent component.
 * @param props A PositronModalDialogComponentProps that contains the modal dialog component properties.
 */
export function PositronModalDialogComponent<T>(props: PositronModalDialogComponentProps & { children: React.ReactNode }) {
	// Memoize the keydown event handler.
	const keydownHandler = useCallback((event: DocumentKeyboardEvent) => {
		// Eat all keydown events.
		event.preventDefault();
		event.stopPropagation();

		// Handle the event.
		switch (event.key) {
			case 'Enter':
				props.enter?.();
				break;
			case 'Escape':
				props.escape?.();
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
			<div className='positron-modal-dialog-box' role='dialog' tabIndex={-1}>
				<div className='positron-modal-dialog-box-frame' style={{ width: props.width, height: props.height }}>
					{props.children}
				</div>
			</div>
		</div>
	);
}
