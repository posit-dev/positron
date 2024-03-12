/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalPopup';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Focusable element selectors.
 */
const focusableElementSelectors =
	'a[href]:not([disabled]),' +
	'button:not([disabled]),' +
	'textarea:not([disabled]),' +
	'input[type="text"]:not([disabled]),' +
	'input[type="radio"]:not([disabled]),' +
	'input[type="checkbox"]:not([disabled]),' +
	'select:not([disabled])';

// Position interface.
interface Position {
	top: number | 'auto';
	right: number | 'auto';
	bottom: number | 'auto';
	left: number | 'auto';
}

/**
 * PopupPosition type.
 */
export type PopupPosition = 'top' | 'bottom';

/**
 * PopupAlignment type.
 */
export type PopupAlignment = 'left' | 'right';

/**
 * KeyboardNavigation type.
 */
export type KeyboardNavigation = 'dialog' | 'menu';

/**
 * PositronModalPopupProps interface.
 */
export interface PositronModalPopupProps {
	renderer: PositronModalReactRenderer;
	containerElement: HTMLElement;
	anchorElement: HTMLElement;
	popupPosition: PopupPosition;
	popupAlignment: PopupAlignment;
	minWidth?: number;
	width: number | 'max-content';
	height: number | 'min-content';
	keyboardNavigation: KeyboardNavigation;
	onDismiss: () => void;
}

/**
 * PositronModalPopup component.
 * @param props A PositronModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronModalPopup = (props: PropsWithChildren<PositronModalPopupProps>) => {
	/**
	 * Computes the popup position.
	 * @returns The popup position.
	 */
	const computePosition = (): Position => {
		const topLeftOffset = DOM.getTopLeftOffset(props.anchorElement);
		return {
			top: props.popupPosition === 'top' ?
				'auto' :
				topLeftOffset.top + props.anchorElement.offsetHeight + 1,
			right: props.popupAlignment === 'right' ?
				props.containerElement.offsetWidth - (topLeftOffset.left + props.anchorElement.offsetWidth) :
				'auto',
			bottom: 'auto',
			left: props.popupAlignment === 'left' ?
				topLeftOffset.left :
				'auto'
		};
	};

	// Reference hooks.
	const popupContainerRef = useRef<HTMLDivElement>(undefined!);
	const popupRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [position, setPosition] = useState<Position>(computePosition());

	/**
	 * Checks whether the specified mouse event happened within the popup.
	 * @param e The mouse event.
	 * @returns A value which indicates whether the specified mouse event happened within the popup.
	 */
	const popupContainsMouseEvent = (e: MouseEvent) => {
		const clientRect = popupRef.current.getBoundingClientRect();
		return e.clientX >= clientRect.left && e.clientX <= clientRect.right &&
			e.clientY >= clientRect.top && e.clientY <= clientRect.bottom;
	};

	// Main useEffect.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onKeyDown event handler.
		disposableStore.add(props.renderer.onKeyDown(e => {
			/**
			 * Consumes an event.
			 */
			const consumeEvent = () => {
				e.preventDefault();
				e.stopPropagation();
			};

			/**
			 * Navigates through focusable elements.
			 * @param direction The navigation direction.
			 * @param wrap A value which indicates whether navgation wraps.
			 */
			const navigateFocusableElements = (direction: 'next' | 'previous', wrap: boolean) => {
				// Get the focusable elements.
				const focusableElements = popupContainerRef.current.querySelectorAll<HTMLElement>(
					focusableElementSelectors
				);

				// If there are no focusable elements in the modal popup, consume the event and
				// return to prevent the user from tabbing outside of the popup.
				if (!focusableElements.length) {
					return;
				}

				// For convenience, get the first and last focusable elements.
				const firstFocusableElement = focusableElements[0];
				const lastFocusableElement = focusableElements[focusableElements.length - 1];

				// Get the active element.
				const activeElement = DOM.getActiveElement();

				// Get the focusable element index.
				const focusableElementIndex = (() => {
					// Enumerate the focusable elements and determine whether one of them is
					// the active element.
					if (activeElement) {
						for (let i = 0; i < focusableElements.length; i++) {
							if (focusableElements[i] === activeElement) {
								return i;
							}
						}
					}

					// The active element is not a focusable element.
					return -1;
				})();

				// If the user is tabbing forward, wrap around at the last element;
				// otherwise, the user is tabbing backward, so wrap around at the first
				// element.
				if (direction === 'next') {
					if (focusableElementIndex === -1 ||
						(wrap && activeElement === lastFocusableElement)) {
						firstFocusableElement.focus();
					} else {
						if (focusableElementIndex < focusableElements.length - 1) {
							focusableElements[focusableElementIndex + 1].focus();
						}
					}
				} else if (direction === 'previous') {
					if (focusableElementIndex === -1 ||
						(wrap && activeElement === firstFocusableElement)) {
						lastFocusableElement.focus();
					} else {
						if (focusableElementIndex > 0) {
							focusableElements[focusableElementIndex - 1].focus();
						}
					}
				}
			};

			// Handle the event.
			switch (e.code) {
				// Escape dismisses the modal popup.
				case 'Escape': {
					consumeEvent();
					props.onDismiss();
					break;
				}

				// When keyboard navigation is dialog, tab moves focus between modal popup elements.
				// This code works to keep the focus in the modal popup.
				case 'Tab': {
					if (props.keyboardNavigation === 'dialog') {
						navigateFocusableElements(!e.shiftKey ? 'next' : 'previous', true);
					}
					consumeEvent();
					break;
				}

				// When keyboard navigation is menu, arrow up moves focus upwards through the modal
				// popup elements.
				case 'ArrowUp': {
					if (props.keyboardNavigation === 'menu') {
						navigateFocusableElements('previous', false);
						consumeEvent();
					}
					break;
				}

				// When keyboard navigation is menu, arrow down moves focus downwards through the
				// modal popup elements.
				case 'ArrowDown': {
					if (props.keyboardNavigation === 'menu') {
						navigateFocusableElements('next', false);
						consumeEvent();
					}
					break;
				}

				// Allow space and enter so buttons in the modal popup can be pressed.
				case 'Space':
				case 'Enter':
					break;

				// Eat other keys to prevent the user from executing actions.
				default:
					consumeEvent();
					break;
			}
		}));

		// Add the onMouseDown event handler.
		disposableStore.add(props.renderer.onMouseDown(e => {
			if (!popupContainsMouseEvent(e)) {
				props.onDismiss();
			}
		}));

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			setPosition(computePosition());
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Create the class names.
	const classNames = positronClassNames(
		'positron-modal-popup',
		props.popupPosition === 'top' ? 'shadow-top' : 'shadow-bottom'
	);

	// Render.
	return (
		<div
			ref={popupContainerRef}
			className='positron-modal-popup-container'
			role='dialog'
			tabIndex={-1}
		>
			<div
				ref={popupRef}
				className={classNames}
				style={{
					...position,
					minWidth: props.minWidth,
					width: props.width,
					height: props.height
				}}
			>
				{props.children}
			</div>
		</div>
	);
};
