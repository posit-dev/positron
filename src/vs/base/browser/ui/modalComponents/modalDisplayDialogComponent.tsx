/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDisplayDialogComponent';
const React = require('react');
import { useCallback, useEffect } from 'react';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

/**
 * ModalDisplayDialogComponentProps interface.
 */
export interface ModalDisplayDialogComponentProps {
	enableEscape: boolean;
	enableEnter: boolean;
	done: () => void;
}

/**
 * ModalDisplayDialogComponent component.
 * @param props A ModalDisplayComponentProps that contains the modal display component properties.
 */
export function ModalDisplayDialogComponent(props: ModalDisplayDialogComponentProps & { children: React.ReactNode }) {
	// If any keyboard handlers are enabled, set up the necessary hooks.
	if (props.enableEnter || props.enableEscape) {
		// Hooks.
		const keyboardHandler = useCallback((event: DocumentKeyboardEvent) => {
			switch (event.key) {
				case 'Escape':
					if (props.enableEscape) {
						event.stopPropagation();
						props.done();
					}
					break;
				case 'Enter':
					if (props.enableEnter) {
						event.stopPropagation();
						props.done();
					}
					break;
			}
		}, []);

		useEffect(() => {
			document.addEventListener('keydown', keyboardHandler, false);
			return () => {
				document.removeEventListener('keydown', keyboardHandler, false);
			};
		}, []);
	}

	// Render.
	return (
		<div className='monaco-modal-dialog-shadow-container'>
			<div className='monaco-modal-dialog-box' role='dialog' tabIndex={-1}>
				<div className='monaco-modal-dialog-box-frame'>
					{props.children}
				</div>
			</div>
		</div>
	);
}


