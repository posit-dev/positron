/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogComponent';
import * as DOM from 'vs/base/browser/dom';
import { createRoot, Root } from 'react-dom/client';

/**
 * ReactRenderer class.
 * Manages rendering a React component in the specified container HTMLElement.
 */
export class ReactRenderer {

	private _modalBlockElement?: HTMLElement;
	private _root?: Root;

	/**
	 * Initializes a new instance of the modal dialog renderer.
	 * @param container The container HTMLElement where the modal dialog will be presented.
	 */
	constructor(container: HTMLElement) {
		this._modalBlockElement = container.appendChild(DOM.$(`.monaco-modal-dialog-modal-block.dimmed`));
	}

	/**
	 * Renders the specified ReactElement.
	 * @param reactElement
	 */
	public render(reactElement: React.ReactElement) {
		if (this._modalBlockElement) {
			this._root = createRoot(this._modalBlockElement);
			this._root.render(reactElement);
		}
	}

	public destroy() {
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}

		// Remove the modal block element.
		if (this._modalBlockElement) {
			this._modalBlockElement.remove();
			this._modalBlockElement = undefined;
		}
	}
}
