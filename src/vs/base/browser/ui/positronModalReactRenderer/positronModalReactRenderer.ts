/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalReactRenderer';

// React.
import type { ReactElement } from 'react';

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { Emitter } from 'vs/base/common/event';
import { createRoot, Root } from 'react-dom/client';
import { Disposable } from 'vs/base/common/lifecycle';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IKeyEventProcessor } from 'vs/base/browser/ui/positronModalReactRenderer/keyEventProcessor';

/**
 * Constants.
 */
const KEYDOWN = 'keydown';
const MOUSEDOWN = 'mousedown';
const RESIZE = 'resize';

/**
 * PositronModalReactRendererOptions interface.
 */
interface PositronModalReactRendererOptions {
	readonly container: HTMLElement;
	readonly keyEventProcessor?: IKeyEventProcessor;
}

/**
 * PositronModalReactRenderer class.
 * Manages rendering a React element as a modal popup.
 */
export class PositronModalReactRenderer extends Disposable {
	//#region Private Static Properties
	//#endregion Private Static Properties

	/**
	 * The set of active renderers.
	 */
	private static _activeRenderers = new Set<PositronModalReactRenderer>();

	/**
	 * Unbind event listeners function that unbinds the most recently bound event listeners.
	 */
	private static _unbindEventListeners?: () => void;

	//#region Private Properties

	/**
	 * Gets the key event processor.
	 */
	private readonly _keyEventProcessor?: IKeyEventProcessor;

	/**
	 * Gets or sets the container element where the modal popup will be presented.
	 */
	private _container?: HTMLElement;

	/**
	 * Gets or sets the overlay element where the modal popup will be presented.
	 */
	private _overlay?: HTMLElement;

	/**
	 * Gets or sets the root where the React element will be rendered.
	 */
	private _root?: Root;

	/**
	 * The onKeyDown event emitter.
	 */
	private readonly _onKeyDownEmitter = this._register(new Emitter<KeyboardEvent>);

	/**
	 * The onMouseDown event emitter.
	 */
	private readonly _onMouseDownEmitter = this._register(new Emitter<MouseEvent>);

	/**
	 * The onMouseDown event emitter.
	 */
	private readonly _onResizeEmitter = this._register(new Emitter<UIEvent>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Initializes a new instance of the PositronModalReactRenderer class.
	 * @param options A PositronModalReactRendererOptions containing the options.
	 */
	constructor(options: PositronModalReactRendererOptions) {
		// Call the base class's constructor.
		super();

		// Set the key event processor.
		this._keyEventProcessor = options.keyEventProcessor;

		// Set the container element.
		this._container = options.container;

		// Create the overlay element.
		this._overlay = this._container.appendChild(DOM.$('.positron-modal-overlay'));
		this._root = createRoot(this._overlay);
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();

		// Unmount the root.
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}

		// Remove the overlay.
		if (this._overlay) {
			this._overlay?.remove();
			this._overlay = undefined;
		}

		//
		this._container = undefined;

		//
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
	readonly onKeyDown = this._onKeyDownEmitter.event;

	/**
	 * onMouseDown event.
	 */
	readonly onMouseDown = this._onMouseDownEmitter.event;

	/**
	 * onResize event.
	 */
	readonly onResize = this._onResizeEmitter.event;

	//#endregion Public Events


	//#region Public Methods

	/**
	 * Renders the ReactElement that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: ReactElement) {
		if (this._container && this._overlay && this._root) {
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
			const containerWindow = DOM.getWindow(positronModalReactRenderer._container);

			/**
			 * keydown handler.
			 * @param e A KeyboardEvent that describes a user interaction with the keyboard.
			 */
			const keydownHandler = (e: KeyboardEvent) => {
				// Process the key event if an IKeyEventProcessor was supplied.
				if (positronModalReactRenderer._keyEventProcessor) {
					positronModalReactRenderer._keyEventProcessor.processKeyEvent(
						new StandardKeyboardEvent(e)
					);
				}

				// Fire the onKeyDown event.
				positronModalReactRenderer._onKeyDownEmitter.fire(e);
			};

			/**
			 * mousedown handler.
			 * @param e A MouseEvent that describes a user interaction with the mouse.
			 */
			const mousedownHandler = (e: MouseEvent) => {
				positronModalReactRenderer._onMouseDownEmitter.fire(e);
			};

			/**
			 * resize handler.
			 * @param e A UIEvent.
			 */
			const resizeHandler = (e: UIEvent) => {
				[...PositronModalReactRenderer._activeRenderers].forEach(renderer => {
					renderer._onResizeEmitter.fire(e);
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
