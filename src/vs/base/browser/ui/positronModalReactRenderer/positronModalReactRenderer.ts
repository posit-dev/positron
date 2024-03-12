/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalReactRenderer';

// React.
import type { ReactElement } from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { createRoot, Root } from 'react-dom/client';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';

/**
 * Constants.
 */
const KEYDOWN = 'keydown';
const MOUSEDOWN = 'mousedown';
const RESIZE = 'resize';

/**
 * PositronModalReactRenderer class.
 * Manages rendering a React element as a modal popup.
 */
export class PositronModalReactRenderer extends Disposable {
	//#region Private Properties

	/**
	 * The set of active renderers.
	 */
	private static _activeRenderers = new Set<PositronModalReactRenderer>();

	/**
	 * Unbind event listeners function that unbinds the most recent event listeners.
	 */
	private static _unbindEventListeners?: () => void;

	/**
	 * The container element where the modal popup will be presented.
	 */
	private _containerElement?: HTMLElement;

	/**
	 * The overlay element where the modal popup will be presented.
	 */
	private _overlayElement?: HTMLElement;

	/**
	 * The root where the React element will be rendered.
	 */
	private _root?: Root;

	/**
	 * The onKeyDown event emitter.
	 */
	private readonly _onKeyDown = this._register(new Emitter<KeyboardEvent>);

	/**
	 * The onMouseDown event emitter.
	 */
	private readonly _onMouseDown = this._register(new Emitter<MouseEvent>);

	/**
	 * The onMouseDown event emitter.
	 */
	private readonly _onResize = this._register(new Emitter<UIEvent>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Initializes a new instance of the PositronModalReactRenderer class.
	 * @param containerElement The container element.
	 */
	constructor(containerElement: HTMLElement) {
		// Call the base class's constructor.
		super();

		// Set the container element.
		this._containerElement = containerElement;

		// Create the overlay element.
		this._overlayElement = containerElement.appendChild(DOM.$('.positron-modal-overlay'));
		this._root = createRoot(this._overlayElement);
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		super.dispose();

		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}

		if (this._overlayElement) {
			this._overlayElement?.remove();
			this._overlayElement = undefined;
		}

		this._containerElement = undefined;

		if (PositronModalReactRenderer._activeRenderers.has(this)) {
			PositronModalReactRenderer._activeRenderers.delete(this);
			PositronModalReactRenderer.bindEventListeners();
		}
	}

	//#endregion Constructor & Dispose

	//#region Public Events

	/**
	 * onKeyDown event.
	 */
	readonly onKeyDown = this._onKeyDown.event;

	/**
	 * onMouseDown event.
	 */
	readonly onMouseDown = this._onMouseDown.event;

	/**
	 * onResize event.
	 */
	readonly onResize = this._onResize.event;

	//#endregion Public Events


	//#region Public Methods

	/**
	 * Renders the ReactElement that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: ReactElement) {
		if (this._containerElement && this._overlayElement && this._root) {
			this._root.render(reactElement);
			PositronModalReactRenderer._activeRenderers.add(this);
			PositronModalReactRenderer.bindEventListeners();
		}
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Binds event listeners.
	 */
	private static bindEventListeners() {
		// Unbind previous event listeners.
		if (PositronModalReactRenderer._unbindEventListeners) {
			PositronModalReactRenderer._unbindEventListeners();
			PositronModalReactRenderer._unbindEventListeners = undefined;
		}

		// Get the renderer to bind to. If there is one, bind the event listeners.
		const positronModalReactRenderer = [...PositronModalReactRenderer._activeRenderers].pop();
		if (positronModalReactRenderer) {
			// Get the container window.
			const containerWindow = DOM.getWindow(positronModalReactRenderer._containerElement);

			/**
			 * keydown handler.
			 * @param e A KeyboardEvent that describes a user interaction with the keyboard.
			 */
			const keydownHandler = (e: KeyboardEvent) => {
				positronModalReactRenderer._onKeyDown.fire(e);
			};

			/**
			 * mousedown handler.
			 * @param e A MouseEvent that describes a user interaction with the mouse.
			 */
			const mousedownHandler = (e: MouseEvent) => {
				positronModalReactRenderer._onMouseDown.fire(e);
			};

			/**
			 * resize handler.
			 * @param e A UIEvent.
			 */
			const resizeHandler = (e: UIEvent) => {
				[...PositronModalReactRenderer._activeRenderers].forEach(renderer => {
					renderer._onResize.fire(e);
				});
			};

			// Add global keydown, mousedown, and resize event listeners.
			containerWindow.addEventListener(KEYDOWN, keydownHandler, true);
			containerWindow.addEventListener(MOUSEDOWN, mousedownHandler, false);
			containerWindow.addEventListener(RESIZE, resizeHandler, false);

			// Return the cleanup function that removes our event listeners.
			PositronModalReactRenderer._unbindEventListeners = () => {
				// Remove keydown, mousedown, and resize event listeners.
				containerWindow.removeEventListener(KEYDOWN, keydownHandler, true);
				containerWindow.removeEventListener(MOUSEDOWN, mousedownHandler, false);
				containerWindow.removeEventListener(RESIZE, resizeHandler, false);
			};
		}
	}

	//#emdregion Private Methods
}
