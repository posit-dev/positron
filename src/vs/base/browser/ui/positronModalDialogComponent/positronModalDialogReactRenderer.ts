/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalDialogComponent';
import * as DOM from 'vs/base/browser/dom';
import { createRoot, Root } from 'react-dom/client';

/**
 * PositronModalDialogReactRenderer class.
 * Manages rendering a React component as a modal dialog.
 */
export class PositronModalDialogReactRenderer {
	/**
	 * The container element where the React element will be rendered.
	 */
	private _container?: HTMLElement;

	/**
	 * The root where the React element will be rendered.
	 */
	private _root?: Root;

	/**
	 * Initializes a new instance of the PositronModalDialogReactRenderer class.
	 * @param container The container HTMLElement where the modal dialog will be presented.
	 */
	constructor(container: HTMLElement) {
		this._container = container.appendChild(DOM.$('.positron-modal-dialog-modal-block.dimmed'));
		this._root = createRoot(this._container);
	}

	/**
	 * Renders the ReactElement that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: React.ReactElement) {
		if (this._root) {
			this._root.render(reactElement);
		}
	}

	/**
	 * Destroys the ReactRenderer.
	 */
	public destroy() {
		// Unmount the root.
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}

		// Remove the container element.
		if (this._container) {
			this._container.remove();
			this._container = undefined;
		}
	}
}
