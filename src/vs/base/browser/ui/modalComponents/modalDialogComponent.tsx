/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogComponent';
const React = require('react');
import { useCallback, useEffect } from 'react';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

/**
 * ModalDialogComponentProps interface.
 */
export interface ModalDialogComponentProps<T> {
	enableEscape: boolean;
	enableEnter: boolean;
	cancel: () => void;
	result: (result: T) => void;
}

interface ModalDialogProps {
	escape: () => void;
	enter: () => void;
	children: React.ReactNode;
}

/**
 * ModalDialogComponent component.
 * @param props A ModalDialogComponentProps that contains the modal dialog component properties.
 */
export function ModalDialogComponent<T>(props: ModalDialogComponentProps<T> & ModalDialogProps) {
	// Hooks.
	const keyboardHandler = useCallback((event: DocumentKeyboardEvent) => {
		if (event.key === 'Escape') {
			if (props.enableEscape) {
				event.stopPropagation();
				props.escape();
			}
		} else if (event.key === 'Enter') {
			if (props.enableEnter) {
				event.stopPropagation();
				props.enter();
			}
		}
	}, []);

	useEffect(() => {
		document.addEventListener('keydown', keyboardHandler, false);
		return () => {
			document.removeEventListener('keydown', keyboardHandler, false);
		};
	}, []);

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
