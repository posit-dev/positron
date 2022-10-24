/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialog';
const React = require('react');
import { PropsWithChildren, useCallback, useEffect, FC } from 'react';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { SimpleTitleBar } from 'vs/workbench/browser/parts/positronModalDialog/components/simpleTitleBar';
import { ContentArea } from 'vs/workbench/browser/parts/positronModalDialog/components/contentArea';
import { OKCancelActionBar } from 'vs/workbench/browser/parts/positronModalDialog/components/okCancelActionBar';
import { PositronModalDialogReactRenderer } from 'vs/workbench/browser/parts/positronModalDialog/positronModalDialogReactRenderer';

/**
 * Grossness.
 */
interface DocumentKeyboardEvent extends globalThis.KeyboardEvent { }

export type ModalDialogOptions<T, C> = {
	input: T;
	Editor: ModalDialogEditor<T, C>;
	title: string;
	width: number;
	height: number;
	layoutService: ILayoutService;
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
	const { input, Editor, title, width, height, layoutService, context } = options;

	// Return a promise that resolves when the modal dialog is done.
	return new Promise<T | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

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
				<PositronModalDialog width={width} height={height} enter={acceptHandler} escape={cancelHandler}>
					<SimpleTitleBar title={title} />
					<ContentArea>
						<Editor input={input} onAccept={onAccept} context={context} />
					</ContentArea>
					<OKCancelActionBar ok={acceptHandler} cancel={cancelHandler} />
				</PositronModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});


}



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
export function PositronModalDialog<T>(props: PropsWithChildren<PositronModalDialogProps>) {
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
