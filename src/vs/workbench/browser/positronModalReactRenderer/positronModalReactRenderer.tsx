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
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResultKind } from 'vs/platform/keybinding/common/keybindingResolver';

/**
 * Commands that are allowed through.
 */
const ALLOWABLE_COMMANDS = [
	'copy',
	'cut',
	'undo',
	'redo',
	'editor.action.selectAll',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardPasteAction',
	'workbench.action.quit',
	'workbench.action.reloadWindow'
];

/**
 * Constants.
 */
const KEYDOWN = 'keydown';
const MOUSEDOWN = 'mousedown';
const RESIZE = 'resize';

/**
 * PositronModalReactRendererOptions interface.
 */
export interface PositronModalReactRendererOptions {
	readonly keybindingService: IKeybindingService;
	readonly layoutService: ILayoutService;
	readonly container: HTMLElement;
	readonly parent?: HTMLElement;
	readonly onDisposed?: () => void;
}

/**
 * PositronModalReactRenderer class.
 * Manages rendering a React element as a modal popup.
 */
export class PositronModalReactRenderer extends Disposable {
	//#region Private Static Properties

	/**
	 * The renderers stack.
	 */
	private static readonly _renderersStack = new Set<PositronModalReactRenderer>();

	/**
	 * Unbind callback that unbinds the most recently bound event listeners.
	 */
	private static _unbindCallback?: () => void;

	//#endregion Private Static Properties

	//#region Private Properties

	/**
	 * Gets the options.
	 */
	private readonly _options: PositronModalReactRendererOptions;

	/**
	 * Gets or sets the overlay element.
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
	 * The onResize event emitter.
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

		// Set the options.
		this._options = options;
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();

		// If this renderer was rendered, dispose it.
		if (this._overlay && this._root) {
			// If there is a parent, remove its aria-expanded property.
			if (this._options.parent) {
				this._options.parent.removeAttribute('aria-expanded');
			}

			// Unmount the root.
			this._root.unmount();
			this._root = undefined;

			// Remove the overlay from from the container.
			this._overlay.remove();
			this._overlay = undefined;

			// Delete this renderer from the renderers stack and bind event listeners.
			PositronModalReactRenderer._renderersStack.delete(this);
			PositronModalReactRenderer.bindEventListeners();
		}

		// Call the onDisposed callback.
		if (this._options.onDisposed) {
			this._options.onDisposed();
		}
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the keybinding service.
	 */
	get keybindingService() {
		return this._options.keybindingService;
	}

	/**
	 * Gets the layout service.
	 */
	get layoutService() {
		return this._options.layoutService;
	}

	/**
	 * Gets the container.
	 */
	get container() {
		return this._options.container;
	}

	//#endregion Public Properties

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
		// Prevent rendering more than once.
		if (!this._overlay && !this._root) {
			// If there is a parent, set its aria-expanded property to true.
			if (this._options.parent) {
				this._options.parent.setAttribute('aria-expanded', 'true');
			}

			// Create the overlay element in the container and the root element in the overlay
			// element.
			this._overlay = this._options.container.appendChild(DOM.$('.positron-modal-overlay'));
			this._root = createRoot(this._overlay);

			// Render the ReactElement that was supplied.
			this._root.render(reactElement);

			// Push this renderer onto the renderers stack and bind event listeners.
			PositronModalReactRenderer._renderersStack.add(this);
			PositronModalReactRenderer.bindEventListeners();
		}
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Binds event listeners.
	 */
	private static bindEventListeners() {
		// Unbind the most recently bound event listeners.
		if (PositronModalReactRenderer._unbindCallback) {
			PositronModalReactRenderer._unbindCallback();
			PositronModalReactRenderer._unbindCallback = undefined;
		}

		// Get the renderer to bind event listeners for. If there isn't one, return.
		const renderer = [...PositronModalReactRenderer._renderersStack].pop();
		if (!renderer) {
			return;
		}

		// Get the window for the renderer.
		const window = DOM.getWindow(renderer._options.container);

		/**
		 * keydown handler.
		 * @param e A KeyboardEvent that describes a user interaction with the keyboard.
		 */
		const keydownHandler = (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			// Soft dispatch the key event so we can determine whether it is bound to a command.
			const resolutionResult = renderer._options.keybindingService.softDispatch(
				event,
				renderer._options.layoutService.activeContainer
			);

			// If a keybinding to a command was found, stop it from being processed if it is not one of
			// the allowable commands.
			if (resolutionResult.kind === ResultKind.KbFound && resolutionResult.commandId) {
				if (ALLOWABLE_COMMANDS.indexOf(resolutionResult.commandId) === -1) {
					DOM.EventHelper.stop(event, true);
				}
			}

			// Fire the onKeyDown event.
			renderer._onKeyDownEmitter.fire(e);
		};

		/**
		 * mousedown handler.
		 * @param e A MouseEvent that describes a user interaction with the mouse.
		 */
		const mousedownHandler = (e: MouseEvent) => {
			renderer._onMouseDownEmitter.fire(e);
		};

		/**
		 * resize handler.
		 * @param e A UIEvent.
		 */
		const resizeHandler = (e: UIEvent) => {
			PositronModalReactRenderer._renderersStack.forEach(renderer => {
				renderer._onResizeEmitter.fire(e);
			});
		};

		// Add global keydown, mousedown, and resize event listeners.
		window.addEventListener(KEYDOWN, keydownHandler, true);
		window.addEventListener(MOUSEDOWN, mousedownHandler, false);
		window.addEventListener(RESIZE, resizeHandler, false);

		// Return the cleanup function that removes our event listeners.
		PositronModalReactRenderer._unbindCallback = () => {
			// Remove keydown, mousedown, and resize event listeners.
			window.removeEventListener(KEYDOWN, keydownHandler, true);
			window.removeEventListener(MOUSEDOWN, mousedownHandler, false);
			window.removeEventListener(RESIZE, resizeHandler, false);
		};
	}

	//#endregion Private Methods
}
