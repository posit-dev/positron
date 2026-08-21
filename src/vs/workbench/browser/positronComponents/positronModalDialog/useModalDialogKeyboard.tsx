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
 * Focusable element selectors.
 */
const focusableElementSelectors =
	'a[href]:not([disabled]),' +
	'button:not([disabled]),' +
	'textarea:not([disabled]),' +
	'input[type="text"]:not([disabled]),' +
	'input[type="number"]:not([disabled]),' +
	'input[type="radio"]:not([disabled]),' +
	'input[type="checkbox"]:not([disabled]),' +
	'select:not([disabled])';

/**
 * Whatever supplies keydown events to the dialog. A modal renderer fires window-level keydowns
 * through an event of this shape, so a dialog component does not need to know which renderer it is
 * mounted in.
 */
export interface IModalDialogKeyboardSource {
	readonly onKeyDown: Event<KeyboardEvent>;
}

/**
 * IModalDialogKeyboardOptions interface.
 */
export interface IModalDialogKeyboardOptions {
	readonly keyboardSource: IModalDialogKeyboardSource;
	readonly dialogBoxRef: RefObject<HTMLElement | null>;
	readonly onCancel?: () => void;

	/**
	 * When false, Enter is left alone, because the caller wraps its content in a <form> whose
	 * implicit submit target already handles it. Defaults to true.
	 */
	readonly enterActivatesDefaultButton?: boolean;
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
		enterActivatesDefaultButton = true
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
				// Enter clicks the first default button that is not disabled, if there is one.
				case 'Enter': {
					// Callers with a <form> let its implicit submit target handle Enter.
					if (!enterActivatesDefaultButton) {
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
					consumeEvent();
					onCancel?.();
					break;
				}

				// Tab moves between dialog elements. This code works to keep the focus in the dialog.
				case 'Tab': {
					// Get the focusable elements.
					// eslint-disable-next-line no-restricted-syntax
					const focusableElements = dialogBox.querySelectorAll<HTMLElement>(
						focusableElementSelectors
					);

					// If there are focusable elements in the modal dialog, keep focus in the dialog;
					// otherwise, prevent focus from going outside of the dialog.
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
	}, [keyboardSource, dialogBoxRef, onCancel, enterActivatesDefaultButton]);
}
