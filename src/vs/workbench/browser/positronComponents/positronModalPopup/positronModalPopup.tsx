/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalPopup';

// React.
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Constants.
 */
const MIN_SCROLLABLE_HEIGHT = 75;

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

/**
 * PopupStyle class.
 */
class PopupStyle {
	top: number | 'auto' = 'auto';
	right: number | 'auto' = 'auto';
	bottom: number | 'auto' = 'auto';
	left: number | 'auto' = 'auto';
	maxWidth: number | 'auto' = 'auto';
	maxHeight: number | 'auto' = 'auto';
}

/**
 * AnchorPoint interface.
 */
export interface AnchorPoint {
	clientX: number;
	clientY: number;
}

/**
 * PopupPosition type.
 */
export type PopupPosition = 'top' | 'bottom' | 'auto';

/**
 * PopupAlignment type.
 */
export type PopupAlignment = 'left' | 'right' | 'auto';

/**
 * KeyboardNavigationStyle type.
 */
export type KeyboardNavigationStyle = 'dialog' | 'menu';

/**
 * PositronModalPopupProps interface.
 */
export interface PositronModalPopupProps {
	renderer: PositronModalReactRenderer;
	anchorElement: HTMLElement;
	anchorPoint?: AnchorPoint;
	popupPosition: PopupPosition;
	popupAlignment: PopupAlignment;
	width: number | 'max-content' | 'auto';
	minWidth?: number | 'auto';
	height: number | 'min-content';
	minHeight?: number | 'auto';
	focusableElementSelectors?: string;
	keyboardNavigationStyle: KeyboardNavigationStyle;
	onAccept?: () => void;
}

/**
 * PositronModalPopup component.
 * @param props A PositronModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronModalPopup = (props: PropsWithChildren<PositronModalPopupProps>) => {
	/**
	 * Computes the popup style.
	 * @returns The popup style.
	 */
	const computePopupStyle = useCallback((): PopupStyle => {
		// Create the popup style.
		const popupStyle = new PopupStyle();

		// Calculate the anchor position and size.
		let anchorX: number;
		let anchorY: number;
		let anchorWidth: number;
		let anchorHeight: number;
		if (props.anchorPoint) {
			anchorX = props.anchorPoint.clientX;
			anchorY = props.anchorPoint.clientY;
			anchorWidth = 0;
			anchorHeight = 0;
		} else {
			const topLeftAnchorOffset = DOM.getTopLeftOffset(props.anchorElement);
			anchorX = topLeftAnchorOffset.left;
			anchorY = topLeftAnchorOffset.top;
			anchorWidth = props.anchorElement.offsetWidth;
			anchorHeight = props.anchorElement.offsetHeight;
		}

		/**
		 * Positions the popup at the top of the anchor element.
		 */
		const positionTop = () => {
			popupStyle.bottom = -(anchorY - 1);
			popupStyle.maxHeight = anchorY - 4;
		};

		/**
		 * Positions the popup at the bottom of the anchor element.
		 */
		const positionBottom = () => {
			popupStyle.top = anchorY + anchorHeight + 1;
			popupStyle.maxHeight = props.renderer.container.offsetHeight - 4 - popupStyle.top;
		};

		// Adjust the popup style for the popup position.
		if (props.popupPosition === 'top') {
			positionTop();
		} else if (props.popupPosition === 'bottom') {
			positionBottom();
		} else if (props.popupPosition === 'auto') {
			// Get the children height.
			const childrenHeight = popupChildrenRef.current ?
				popupChildrenRef.current.scrollHeight :
				0;

			// Calculate the ideal bottom.
			const idealBottom = anchorY +
				anchorHeight +
				1 +
				childrenHeight +
				4;

			// Try to position the popup fully at the bottom or fully at the top. If this this
			// isn't possible, try to position the popup with scrolling at the bottom or at the
			// top. If this isn't posssible, fallback to positioning the popup at the top of its
			// container.
			if (idealBottom < props.renderer.container.offsetHeight - 1) {
				positionBottom();
			} else if (childrenHeight < anchorY - 1) {
				positionTop();
			} else {
				// Calculate the max bottom height.
				const top = anchorY + anchorHeight + 1;
				const maxBottomHeight = props.renderer.container.offsetHeight - 4 - top;

				// Position the popup on the bottom with scrolling, if we can.
				if (maxBottomHeight > MIN_SCROLLABLE_HEIGHT) {
					positionBottom();
				} else if (anchorY - 4 > MIN_SCROLLABLE_HEIGHT) {
					positionTop();
				} else {
					// Position the popup at the top of its container.
					popupStyle.top = 4;
					popupStyle.maxHeight = props.renderer.container.offsetHeight - 8;
				}
			}
		}

		/**
		 * Positions the popup aligned with the left edge of the anchor element.
		 */
		const positionLeft = () => {
			popupStyle.left = anchorX;
		};

		/**
		 * Positions the popup aligned with the right edge of the anchor element.
		 */
		const positionRight = () => {
			popupStyle.right = -(anchorX + anchorWidth);
		};

		// Adjust the popup style for the popup alignment.
		if (props.popupAlignment === 'left') {
			positionLeft();
		} else if (props.popupAlignment === 'right') {
			positionRight();
		} else if (props.popupAlignment === 'auto') {
			// Get the children width.
			const childrenWidth = popupChildrenRef.current ?
				popupChildrenRef.current.scrollWidth :
				0;

			// Calculate the ideal right.
			const idealRight = anchorX +
				childrenWidth +
				4;

			// Try to position the popup fully at the bottom or fully at the top. If this this isn't
			// possible, try to position the popup with scrolling at the bottom or at the top. If
			// this isn't posssible, fallback to positioning the popup at the top of its container.
			if (idealRight < props.renderer.container.offsetWidth) {
				positionLeft();
			} else if (childrenWidth < anchorX - 1) {
				positionRight();
			} else {
				popupStyle.left = 0;
			}
		}

		// Return the popup style.
		return popupStyle;
	}, [props.anchorElement, props.anchorPoint, props.popupAlignment, props.popupPosition, props.renderer.container.offsetHeight, props.renderer.container.offsetWidth]);

	// Reference hooks.
	const popupContainerRef = useRef<HTMLDivElement>(undefined!);
	const popupRef = useRef<HTMLDivElement>(undefined!);
	const popupChildrenRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [popupStyle, setPopupStyle] = useState<PopupStyle>(computePopupStyle());

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

	// Layout effect.
	useLayoutEffect(() => {
		setPopupStyle(computePopupStyle());
	}, [computePopupStyle]);

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
					props.focusableElementSelectors ?? focusableElementSelectors
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
				// Enter accepts the modal popup.
				case 'Enter': {
					consumeEvent();
					props.onAccept?.();
					break;
				}

				// Escape dismisses the modal popup.
				case 'Escape': {
					consumeEvent();
					props.renderer.dispose();
					break;
				}

				// When keyboard navigation is dialog, tab moves focus between modal popup elements.
				// This code works to keep the focus in the modal popup.
				case 'Tab': {
					consumeEvent();
					if (props.keyboardNavigationStyle === 'dialog') {
						navigateFocusableElements(!e.shiftKey ? 'next' : 'previous', true);
					}
					break;
				}

				// When keyboard navigation is menu, arrow up moves focus upwards through the modal
				// popup elements.
				case 'ArrowUp': {
					if (props.keyboardNavigationStyle === 'menu') {
						navigateFocusableElements('previous', false);
						consumeEvent();
					}
					break;
				}

				// When keyboard navigation is menu, arrow down moves focus downwards through the
				// modal popup elements.
				case 'ArrowDown': {
					if (props.keyboardNavigationStyle === 'menu') {
						navigateFocusableElements('next', false);
						consumeEvent();
					}
					break;
				}
			}
		}));

		// Add the onMouseDown event handler.
		disposableStore.add(props.renderer.onMouseDown(e => {
			if (!popupContainsMouseEvent(e)) {
				props.renderer.dispose();
			}
		}));

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			setPopupStyle(computePopupStyle());
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [computePopupStyle, props]);

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
					...popupStyle,
					width: props.width,
					minWidth: props.minWidth ?? 'auto',
					height: props.height,
					minHeight: props.minHeight ?? 'auto'
				}}
			>
				<div ref={popupChildrenRef} className='positron-modal-popup-children'>
					{props.children}
				</div>
			</div>
		</div>
	);
};
