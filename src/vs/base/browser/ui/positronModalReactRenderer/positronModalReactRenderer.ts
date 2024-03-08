/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalReactRenderer';

// React.
import type { ReactElement } from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { createRoot, Root } from 'react-dom/client';

/**
 * PositronModalReactRenderer class.
 * Manages rendering a React element as a modal popup.
 */
export class PositronModalReactRenderer {
	/**
	 * The overlay element where the modal popup will be presented.
	 */
	private _overlayElement?: HTMLElement;

	/**
	 * The root where the React element will be rendered.
	 */
	private _root?: Root;

	/**
	 * Initializes a new instance of the PositronModalReactRenderer class.
	 * @param containerElement The container element.
	 */
	constructor(containerElement: HTMLElement) {
		// Create the overlay element.
		this._overlayElement = containerElement.appendChild(DOM.$('.positron-modal-overlay'));
		this._root = createRoot(this._overlayElement);
	}

	/**
	 * Renders the ReactElement that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: ReactElement) {
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

		// Remove the overlay element.
		if (this._overlayElement) {
			this._overlayElement.remove();
			this._overlayElement = undefined;
		}
	}
}
