/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogComponent';
import * as DOM from 'vs/base/browser/dom';
import { createRoot, Root } from 'react-dom/client';

/**
 * ModalDialogPresenter class.
 */
export class ModalDialogPresenter {

	private _modalBlockElement?: HTMLElement;
	private _root?: Root;

	/**
	 * Initializes a new instance of the modal dialog renderer.
	 * @param container The container HTMLElement where the modal dialog will be presented.
	 */
	constructor(container: HTMLElement) {
		this._modalBlockElement = container.appendChild(DOM.$(`.monaco-modal-dialog-modal-block.dimmed`));
	}

	public present(dialog: React.ReactNode) {
		if (this._modalBlockElement) {
			this._root = createRoot(this._modalBlockElement);
			this._root.render(dialog);
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
