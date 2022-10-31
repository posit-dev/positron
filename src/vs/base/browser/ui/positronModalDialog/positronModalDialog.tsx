/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren, useCallback, useEffect } from 'react';
import { SimpleTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/simpleTitleBar';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKCancelActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelActionBar';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

/**
 * OKCancelModalDialogProps interface.
 */
export interface OKCancelModalDialogProps extends PositronModalDialogProps {
	title: string;
	accept: () => void;
	cancel: () => void;
}

/**
 * OKCancelModalDialog component.
 * @param props The properties.
 * @returns The component.
 */
export const OKCancelModalDialog = (props: PropsWithChildren<OKCancelModalDialogProps>) => {
	return (
		<PositronModalDialog {...props}>
			<SimpleTitleBar {...props} />
			<ContentArea>
				{props.children}
			</ContentArea>
			<OKCancelActionBar {...props} />
		</PositronModalDialog>
	);
};

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
				props.accept?.();
				suppressEvent();
				break;
			case 'Escape':
				props.cancel?.();
				suppressEvent();
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
};
