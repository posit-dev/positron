/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialogReactRenderer.css';

// React.
import { ReactElement } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Other dependencies.
import * as DOM from './dom.js';
import { Emitter } from '../common/event.js';
import { Disposable } from '../common/lifecycle.js';
import { KeyCode } from '../common/keyCodes.js';
import { StandardKeyboardEvent } from './keyboardEvent.js';
import { PositronReactServices } from './positronReactServices.js';
import { PositronReactServicesProvider } from './positronReactRendererContext.js';
import { ResultKind } from '../../platform/keybinding/common/keybindingResolver.js';

// Commands that are allowed through while a modal is open.
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
 * Decides how a keydown should be suppressed while a modal is open, given the command (if any) the
 * key resolves to. Extracted from the renderer's window-level keydown handler so it can be
 * unit-tested without a live <dialog>.
 *
 * - If the key resolves to no command, or to an allowable command (copy/cut/paste/etc.), it is left
 *   alone so the modal's inputs keep working.
 * - Escape that resolves to a non-allowable command only gets stopPropagation, so the bound command
 *   does not run but the native <dialog>'s own close-on-Escape (a default action) still fires.
 * - Any other non-allowable bound key gets the full stop (preventDefault + stopPropagation).
 *
 * @param commandId The command the key resolves to, or null when it resolves to none.
 * @param event The keyboard event to (possibly) suppress.
 */
export function applyModalKeydownSuppression(
	commandId: string | null,
	event: { readonly keyCode: KeyCode; preventDefault(): void; stopPropagation(): void },
): void {
	if (commandId === null || ALLOWABLE_COMMANDS.indexOf(commandId) !== -1) {
		return;
	}
	// Escape needs special handling: the native <dialog> closes itself on Escape via the keydown's
	// default action. When Escape is bound to a command in the underlying editor (e.g. a notebook
	// cell's exit-edit-mode binding), only stop propagation so that command does not also run -- do
	// NOT preventDefault, which would suppress the dialog's own close and leave the modal stuck open.
	if (event.keyCode === KeyCode.Escape) {
		event.stopPropagation();
	} else {
		DOM.EventHelper.stop(event, true);
	}
}

/**
 * Options passed to PositronModalDialogReactRenderer. `container` defaults to the active workbench
 * container; `onDisposed` is invoked after the dialog is closed and removed from the DOM.
 */
interface PositronModalDialogReactRendererOptions {
	container?: HTMLElement;
	onDisposed?: () => void;
}

/**
 * PositronModalDialogReactRenderer. Renderer backed by the native <dialog> element using
 * showModal().
 */
export class PositronModalDialogReactRenderer extends Disposable {
	// The number of dialogs currently rendered. Used to detect nested dialogs so we can suppress
	// the backdrop on all but the bottom-most, avoiding compounded dimming.
	private static _openDialogCount = 0;

	// The native <dialog> element we create in render() and close/remove in dispose().
	private _dialog?: HTMLDialogElement;

	// The React root mounted inside the <dialog>; undefined until render() runs.
	private _root?: Root;

	// The element that had focus when this renderer was constructed. We restore focus to it on
	// dispose so closing the dialog returns the user to where they were.
	private readonly _lastFocusedElement: HTMLElement | undefined;

	// A cleanup function that removes any window-level event listeners we bind in render(). We
	// invoke this in dispose() to ensure we don't leave dangling listeners. It's set to undefined
	// when there are no listeners bound.
	private _eventHandlerCleanup?: () => void;

	// Fires for window resize events while the modal is open. Consumers subscribe via onResize
	// to reclamp position.
	private readonly _onResizeEmitter = this._register(new Emitter<UIEvent>());

	// Expose the onResize event for consumers to subscribe to.
	readonly onResize = this._onResizeEmitter.event;

	/**
	 * Constructor.
	 * @param options The PositronModalDialogReactRendererOptions to use when constructing the renderer.
	 * @returns A new PositronModalDialogReactRenderer instance.
	 */
	constructor(private readonly _options: PositronModalDialogReactRendererOptions = {}) {
		// Call super() to initialize the Disposable base class, which provides the _register() method used for managing disposables.
		super();

		// If a container isn't provided, default to the active workbench container.
		if (_options.container === undefined) {
			_options.container = PositronReactServices.services.workbenchLayoutService.activeContainer;
		}

		// Store the currently focused element so we can restore focus to it when the dialog is closed.
		const activeElement = DOM.getActiveWindow().document.activeElement;
		if (DOM.isHTMLElement(activeElement)) {
			this._lastFocusedElement = activeElement;
		}
	}

	/**
	 * Disposes the renderer by closing the dialog, unmounting the React root, removing the dialog
	 * from the DOM, and invoking the onDisposed callback.
	 */
	override dispose(): void {
		// If the dialog is undefined, call super.dispose() and return. This can happen if dispose()
		// is called before render() for some reason.
		if (this._dialog === undefined) {
			super.dispose();
			return;
		}

		// Invoke the event cleanup function to remove any window-level listeners we bound in
		// render() and set it to undefined to indicate we've done so. This ensures we don't leave
		// dangling listeners.
		this._eventHandlerCleanup?.();
		this._eventHandlerCleanup = undefined;

		// Close the dialog first, if it's open, so its focus trap is released before we restore
		// focus.
		if (this._dialog.open) {
			this._dialog.close();
		}

		// Restore focus to the previously focused element, if we have one.
		this._lastFocusedElement?.focus({ preventScroll: true });

		// Unmount and clear the React root.
		this._root?.unmount();
		this._root = undefined;

		// Remove and clear the dialog.
		this._dialog.remove();
		this._dialog = undefined;

		// Decrement the open dialog count.
		PositronModalDialogReactRenderer._openDialogCount--;

		// Call the onDisposed callback, if provided.
		this._options.onDisposed?.();

		// Finally, call super.dispose() to complete the disposal process.
		super.dispose();
	}

	/**
	 * Gets the PositronReactServices.
	 */
	get services(): PositronReactServices {
		return PositronReactServices.services;
	}

	/**
	 * Gets the container element into which this renderer renders its dialog.
	 */
	get container() {
		return this._options.container!;
	}

	/**
	 * Renders the given React element inside a modal dialog.
	 * @param reactElement The React element to render inside the modal dialog.
	 */
	render(reactElement: ReactElement) {
		// If the dialog already exists, log an error and return. This can happen if render() is
		// called more than once for some reason.
		if (this._dialog !== undefined) {
			console.error('[PositronModalDialogReactRenderer] Attempted to render twice');
			return;
		}

		// Create the <dialog> element and append it to the container.
		const dialog = document.createElement('dialog');
		dialog.classList.add('positron-modal-dialog');

		// If another modal dialog is already open, mark this one as nested so its ::backdrop is
		// suppressed and we don't compound the dimming.
		if (PositronModalDialogReactRenderer._openDialogCount > 0) {
			dialog.classList.add('nested');
		}

		// Increment the open dialog count.
		PositronModalDialogReactRenderer._openDialogCount++;

		this._options.container!.appendChild(dialog);
		this._dialog = dialog;

		// Mount the React tree inside the dialog.
		this._root = createRoot(dialog);
		this._root.render(
			<PositronReactServicesProvider>
				{reactElement}
			</PositronReactServicesProvider>
		);

		// Show as modal: browser handles focus trap, Escape, backdrop, top-layer stacking.
		dialog.showModal();

		/**
		 * Keydown handler. We bind this at the window level in the capture phase so it runs before any
		 * other handlers and can stop propagation of any events that aren't for allowable commands. This
		 * is necessary to prevent keybindings from being triggered while the modal is open, which could
		 * lead to unexpected behavior. We allow certain commands like copy/cut/paste/selectAll so that
		 * users can use those features in input fields within the modal.
		 * @param e The KeyboardEvent to handle.
		 */
		const keydownHandler = (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			const resolutionResult = PositronReactServices.services.keybindingService.softDispatch(
				event,
				PositronReactServices.services.workbenchLayoutService.activeContainer
			);
			const commandId = resolutionResult.kind === ResultKind.KbFound ? resolutionResult.commandId : null;
			applyModalKeydownSuppression(commandId, event);
		};

		/**
		 * Resize handler. Fires the onResize event so consumers can respond to window resizes
		 * while the modal is open, such as by reclamping the dialog position.
		 */
		const resizeHandler = (e: UIEvent) => this._onResizeEmitter.fire(e);

		// Close handler. Invokes dispose() when the dialog is closed natively (e.g. by Escape or
		// by anything that calls dialog.close() directly without going through dispose()). Without
		// this, the window-level keydown listener would remain bound and continue intercepting
		// keybindings after the dialog is gone.
		const closeHandler = () => this.dispose();

		// Use the DOM helper to get the window from the dialog, which is important for iframes.
		// Then add the event listeners and store a cleanup function that removes them.
		const window = DOM.getWindow(dialog);
		window.addEventListener('keydown', keydownHandler, true);
		window.addEventListener('resize', resizeHandler, false);
		dialog.addEventListener('close', closeHandler);
		this._eventHandlerCleanup = () => {
			window.removeEventListener('keydown', keydownHandler, true);
			window.removeEventListener('resize', resizeHandler, false);
			dialog.removeEventListener('close', closeHandler);
		};
	}
}
