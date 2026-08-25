/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { RefObject, useEffect } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

/**
 * Tags the browser puts in the tab order with no tabindex of their own. `tabIndex` reports these
 * correctly in a browser, so this is only a backstop for environments that under-report it.
 */
const nativelyTabbableSelector = 'summary,iframe,area[href],audio[controls],video[controls]';

/**
 * Whether Tab can reach an element.
 *
 * This asks the browser rather than naming the tags that count. A hand-written list of tags is not
 * merely incomplete when it misses one: the Tab handler reads an unlisted element as focus escaping
 * the dialog and throws focus back to the top, stranding everything past it. A password input and a
 * <summary> were both missed that way.
 *
 * @param element The element to test.
 */
function isTabbable(element: HTMLElement): boolean {
	// An open quick pick marks the dialog's own children inert, where focusing is a silent no-op.
	// inert is inherited, so test ancestry rather than the attribute.
	if (element.closest('[inert]')) {
		return false;
	}

	// A disabled control reports a tabIndex but cannot take focus.
	if ((element as HTMLElement & { disabled?: boolean }).disabled) {
		return false;
	}

	// So does a hidden one, and counting it puts the boundary in the wrong place: Tab from the real
	// last control is not consumed and focus leaves the dialog, or the wrap focuses something that
	// cannot take it and Tab appears dead. checkVisibility answers for ancestors too, so a control
	// inside a hidden container is caught.
	if (!element.checkVisibility({ checkVisibilityCSS: true })) {
		return false;
	}

	// An explicit tabindex is the author overriding the default, either way.
	const tabIndexAttribute = element.getAttribute('tabindex');
	if (tabIndexAttribute !== null) {
		return Number(tabIndexAttribute) >= 0;
	}

	return element.tabIndex >= 0 || element.matches(nativelyTabbableSelector);
}

/**
 * Whatever supplies keydown events to the dialog. A modal renderer fires window-level keydowns
 * through an event of this shape, so a dialog component does not need to know which renderer it is
 * mounted in.
 */
export interface IModalDialogKeyboardSource {
	readonly onKeyDown: Event<KeyboardEvent>;
}

/**
 * Whether a keystroke came from a quick pick that was reparented into the dialog.
 *
 * The quick pick renders inside the dialog so that it can take focus, but it handles its own keys.
 * The dialog has to leave those alone: Escape closes the quick pick rather than the dialog, and
 * Enter accepts the highlighted item rather than clicking the dialog's default button. The dialog
 * listens in the capture phase, so without this it consumes the keystroke before the quick pick
 * ever sees it.
 *
 * @param target The event target to test.
 */
function isFromQuickPick(target: EventTarget | null): boolean {
	return DOM.isHTMLElement(target) && target.closest('.quick-input-widget') !== null;
}

/**
 * IModalDialogKeyboardOptions interface.
 */
export interface IModalDialogKeyboardOptions {
	readonly keyboardSource: IModalDialogKeyboardSource;
	readonly dialogBoxRef: RefObject<HTMLElement | null>;
	readonly onCancel?: () => void;

	/**
	 * When true, the dialog owns Enter and this hook leaves the key alone. Set it when the dialog
	 * already has something that acts on Enter, such as a <form> with a submit button, so that one
	 * keystroke does not both submit the form and click the default button. Defaults to false,
	 * where Enter clicks the first default button in the dialog.
	 */
	readonly enterHandledByCaller?: boolean;
}

/**
 * Gives a modal dialog its keyboard behavior: Escape cancels, Enter activates the default button,
 * and Tab cycles without leaving the dialog.
 *
 * A native <dialog> provides all three, but only while it is opened with showModal(), which puts it
 * in the browser's top layer and buries everything Positron needs to raise above a dialog. Positron
 * dialogs are ordinary z-indexed elements, so this is written here instead.
 *
 * @param options The IModalDialogKeyboardOptions to use.
 */
export function useModalDialogKeyboard(options: IModalDialogKeyboardOptions): void {
	const {
		keyboardSource,
		dialogBoxRef,
		onCancel,
		enterHandledByCaller = false
	} = options;

	// Main use effect.
	useEffect(() => {
		// Create a disposable store for the event handler we'll add.
		const disposableStore = new DisposableStore();

		// Add the onKeyDown event handler.
		disposableStore.add(keyboardSource.onKeyDown(e => {
			// The dialog box is not mounted yet on the first keydown after render.
			const dialogBox = dialogBoxRef.current;
			if (!dialogBox) {
				return;
			}

			/**
			 * Consumes an event.
			 */
			const consumeEvent = () => {
				e.preventDefault();
				e.stopPropagation();
			};

			// Handle the event.
			switch (e.key) {
				// Enter clicks the first default button that is not disabled, if there is one. This is
				// here for PositronModalDialog, which has no <form>, so Enter pressed anywhere but on
				// a button does nothing on its own. A dialog with a form sets enterHandledByCaller and
				// lets its submit button take the key, so this whole case can go once that is the only
				// kind of dialog left.
				case 'Enter': {
					// The dialog acts on Enter itself, so leave the key to it.
					if (enterHandledByCaller) {
						return;
					}

					// Leave a reparented quick pick's Enter to the quick pick.
					if (isFromQuickPick(e.target)) {
						return;
					}

					// If the active element is a text area, return.
					const activeElement = DOM.getDocument(dialogBox).activeElement;
					if (DOM.isHTMLTextAreaElement(activeElement)) {
						return;
					}

					// Get the first default button that is not disabled. If there is one, click it.
					// eslint-disable-next-line no-restricted-syntax
					const defaultButton = dialogBox.querySelector<HTMLElement>(
						'button.default:not([disabled])'
					);
					if (defaultButton) {
						consumeEvent();
						defaultButton.click();
					}
					break;
				}

				// Escape cancels dialog.
				case 'Escape': {
					// Leave a reparented quick pick's Escape to the quick pick, which closes itself.
					// Without this, dismissing a file picker would close the whole dialog and discard
					// whatever the user had typed into it.
					if (isFromQuickPick(e.target)) {
						return;
					}

					consumeEvent();
					onCancel?.();
					break;
				}

				// Tab moves between dialog elements. This code works to keep the focus in the dialog.
				case 'Tab': {
					// Get the focusable elements.
					// eslint-disable-next-line no-restricted-syntax
					const focusableElements = Array.from(dialogBox.querySelectorAll<HTMLElement>('*'))
						.filter(isTabbable);

					if (focusableElements.length) {
						// For convenience, get the first and last focusable elements.
						const firstFocusableElement = focusableElements[0];
						const lastFocusableElement = focusableElements[focusableElements.length - 1];

						// Get the active element.
						const activeElement = DOM.getActiveElement();

						/**
						 * Determines whether the active element is one of the focusable elements.
						 * @returns true if the active element is one of the focusable element;
						 * otherwise, false.
						 */
						const activeElementIsFocusableElement = () => {
							// Enumerate the focusable elements and determine whether one of them is
							// the active element.
							if (activeElement) {
								for (let i = 0; i < focusableElements.length; i++) {
									if (focusableElements[i] === activeElement) {
										return true;
									}
								}
							}

							// The active element is not a focusable element.
							return false;
						};

						// If the user is tabbing forward, wrap around at the last element; otherwise,
						// the user is tabbing backward, so wrap around at the first element.
						if (!e.shiftKey) {
							if (!activeElement ||
								!activeElementIsFocusableElement() ||
								activeElement === lastFocusableElement) {
								consumeEvent();
								firstFocusableElement.focus();
							}
						} else {
							if (!activeElement ||
								!activeElementIsFocusableElement() ||
								activeElement === firstFocusableElement) {
								consumeEvent();
								lastFocusableElement.focus();
							}
						}
					} else {
						// Prevent focus from going outside of the dialog.
						consumeEvent();
					}
					break;
				}
			}
		}));

		// Return the cleanup function that will dispose of the event handler.
		return () => disposableStore.dispose();
	}, [keyboardSource, dialogBoxRef, onCancel, enterHandledByCaller]);
}
