/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogComponent';
const React = require('react');
import { useCallback, useEffect } from 'react';

/**
 * ModalDialogComponentProps interface.
 */
export interface ModalDialogComponentProps<T> {
	escapeCancels: boolean;
	enterAccepts: boolean;
	cancel: () => void;
	result: (result: T) => void;
}

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

interface ModalDialogProps {
	escape: () => void;
	accept: () => void;
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
			if (props.escapeCancels) {
				event.stopPropagation();
				props.escape();
			}
		} else if (event.key === 'Enter') {
			if (props.enterAccepts) {
				event.stopPropagation();
				props.accept();
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
