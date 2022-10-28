/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren, useCallback, useEffect, FC } from 'react';
import { SimpleTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/simpleTitleBar';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { OKCancelActionBarOld, OKCancelActionBar2 } from 'vs/base/browser/ui/positronModalDialog/components/okCancelActionBar';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

/**
 * OKCancelModalDialogProps interface.
 */
export interface OKCancelModalDialogProps extends PositronModalDialogProps {
	title: string;
	acceptHandler: () => void;
	cancelHandler: () => void;
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
			<OKCancelActionBar2 {...props} />
		</PositronModalDialog>
	);
};

/**
 * PositronModalDialogProps interface.
 */
export interface PositronModalDialogProps {
	width: number;
	height: number;
	enter?: () => void;
	escape?: () => void;
}

/**
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the modal dialog component properties.
 */
export const PositronModalDialog = (props: PropsWithChildren<PositronModalDialogProps>) => {
	// Memoize the keydown event handler.
	const keydownHandler = useCallback((event: DocumentKeyboardEvent) => {
		// Fully suppresses and event.
		const suppressEvent = () => {
			event.preventDefault();
			event.stopPropagation();
		};

		// Handle the event.
		switch (event.key) {
			case 'Enter':
				props.enter?.();
				suppressEvent();
				break;
			case 'Escape':
				props.escape?.();
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

/* --- Code below is being refactored out --- */

export type ModalDialogOptions<T, C> = {
	input: T;
	Editor: ModalDialogEditor<T, C>;
	title: string;
	width: number;
	height: number;
	container: HTMLElement;
	context: C;
};

export type ModalDialogEditor<T, C = Record<string, unknown>> = FC<{
	input: T;
	context: C;
	onAccept: (f: () => T) => void;
}>;

export async function showPositronModalDialog<T, C = Record<string, unknown>>(
	options: ModalDialogOptions<T, C>
) {

	// destruecture
	const { input, Editor, title, width, height, container, context } = options;

	// Return a promise that resolves when the modal dialog is done.
	return new Promise<T | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(container);

		// function called to collect result (and hook for setting it from the editor)
		let accept: (() => T) | undefined;
		const onAccept = (f: () => T) => accept = f;


		// The accept handler.
		const acceptHandler = () => {
			positronModalDialogReactRenderer.destroy();
			if (accept) {
				resolve(accept());
			} else {
				resolve(undefined);
			}
		};

		// The cancel handler
		const cancelHandler = () => {
			positronModalDialogReactRenderer.destroy();
			resolve(undefined);
		};

		// The modal dialog component.
		const ModalDialog = () => {
			return (
				<PositronModalDialogOld width={width} height={height} enter={acceptHandler} escape={cancelHandler}>
					<SimpleTitleBar title={title} />
					<ContentArea>
						<Editor input={input} onAccept={onAccept} context={context} />
					</ContentArea>
					<OKCancelActionBarOld ok={acceptHandler} cancel={cancelHandler} />
				</PositronModalDialogOld>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
}

/**
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the modal dialog component properties.
 */
export function PositronModalDialogOld<T>(props: PropsWithChildren<PositronModalDialogProps>) {
	// Memoize the keydown event handler.
	const keydownHandler = useCallback((event: DocumentKeyboardEvent) => {

		const suppressEvent = () => {
			event.preventDefault();
			event.stopPropagation();
		};

		// Handle the event.
		switch (event.key) {
			case 'Enter':
				props.enter?.();
				suppressEvent();
				break;
			case 'Escape':
				props.escape?.();
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
}

