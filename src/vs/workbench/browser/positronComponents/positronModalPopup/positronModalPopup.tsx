/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalPopup';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { isNumber } from 'vs/base/common/types';
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
 * AnchorLayout class.
 */
class AnchorLayout {
	/**
	 * The anchor x.
	 */
	readonly anchorX: number;

	/**
	 * The anchor y.
	 */
	readonly anchorY: number;

	/**
	 * The anchor width.
	 */
	readonly anchorWidth: number;

	/**
	 * The anchor height.
	 */
	readonly anchorHeight: number;

	/**
	 * Constructor.
	 * @param anchorX The anchor x.
	 * @param anchorY The anchor y.
	 * @param anchorWidth The anchor width.
	 * @param anchorHeight The anchor height.
	 */
	constructor(anchorX: number, anchorY: number, anchorWidth: number, anchorHeight: number) {
		this.anchorX = anchorX;
		this.anchorY = anchorY;
		this.anchorWidth = anchorWidth;
		this.anchorHeight = anchorHeight;
	}
}

/**
 * PopupLayout class.
 */
class PopupLayout {
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
	readonly renderer: PositronModalReactRenderer;
	readonly anchorElement: HTMLElement;
	readonly anchorPoint?: AnchorPoint;
	readonly popupPosition: PopupPosition;
	readonly popupAlignment: PopupAlignment;
	readonly width: number | 'max-content' | 'auto';
	readonly minWidth?: number | 'auto';
	readonly height: number | 'min-content';
	readonly minHeight?: number | 'auto';
	readonly focusableElementSelectors?: string;
	readonly keyboardNavigationStyle: KeyboardNavigationStyle;
	readonly onAccept?: () => void;
}

/**
 * PositronModalPopup component.
 * @param props A PositronModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronModalPopup = (props: PropsWithChildren<PositronModalPopupProps>) => {
	// Setup the anchor layout.
	const [anchorLayout] = useState(() => {
		if (props.anchorPoint) {
			return new AnchorLayout(props.anchorPoint.clientX, props.anchorPoint.clientY, 0, 0);
		} else {
			const topLeftAnchorOffset = DOM.getTopLeftOffset(props.anchorElement);
			return new AnchorLayout(
				topLeftAnchorOffset.left,
				topLeftAnchorOffset.top,
				props.anchorElement.offsetWidth,
				props.anchorElement.offsetHeight
			);
		}
	});

	// Reference hooks.
	const popupContainerRef = useRef<HTMLDivElement>(undefined!);
	const popupRef = useRef<HTMLDivElement>(undefined!);
	const popupChildrenRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [popupLayout, setPopupLayout] = useState<PopupLayout>(() => {
		// Initially, position the popup off screen.
		const newPopupStyle = new PopupLayout();
		newPopupStyle.left = -10000;
		newPopupStyle.top = -10000;
		return newPopupStyle;
	});

	// Layout.
	useLayoutEffect(() => {
		// Get the document width and height.
		const { clientWidth: documentWidth, clientHeight: documentHeight } =
			DOM.getWindow(popupRef.current).document.documentElement;

		// Create the popup layout.
		const popupLayout = new PopupLayout();

		/**
		 * Positions the popup aligned with the left edge of the anchor element.
		 */
		const positionLeft = () => {
			popupLayout.left = anchorLayout.anchorX;
		};

		/**
		 * Positions the popup aligned with the right edge of the anchor element.
		 */
		const positionRight = () => {
			popupLayout.right = -(anchorLayout.anchorX + anchorLayout.anchorWidth);
		};

		// Adjust the popup layout for the popup alignment.
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
			const idealRight = anchorLayout.anchorX +
				childrenWidth +
				4;

			// Try to position the popup fully at the bottom or fully at the top. If this this isn't
			// possible, try to position the popup with scrolling at the bottom or at the top. If
			// this isn't posssible, fallback to positioning the popup at the top of its container.
			if (idealRight < documentWidth) {
				positionLeft();
			} else if (childrenWidth < anchorLayout.anchorX - 1) {
				positionRight();
			} else {
				popupLayout.left = 0;
			}
		}

		/**
		 * Positions the popup at the bottom of the anchor element.
		 */
		const positionBottom = () => {
			popupLayout.top = anchorLayout.anchorY + anchorLayout.anchorHeight + 1;
			popupLayout.maxHeight = documentHeight - 4 - popupLayout.top;
		};

		/**
		 * Positions the popup at the top of the anchor element.
		 */
		const positionTop = () => {
			popupLayout.bottom = -(anchorLayout.anchorY - 1);
			popupLayout.maxHeight = anchorLayout.anchorY - 4;
		};

		// Adjust the popup layout for the popup position.
		if (props.popupPosition === 'bottom') {
			positionBottom();
		} else if (props.popupPosition === 'top') {
			positionTop();
		} else if (props.popupPosition === 'auto') {
			// Get the children height.
			const childrenHeight = popupChildrenRef.current ?
				popupChildrenRef.current.scrollHeight :
				0;

			// Calculate the ideal bottom.
			const idealBottom = anchorLayout.anchorY +
				anchorLayout.anchorHeight +
				1 +
				childrenHeight +
				4;

			// Try to position the popup fully at the bottom or fully at the top. If this this
			// isn't possible, try to position the popup with scrolling at the bottom or at the
			// top. If this isn't posssible, fallback to positioning the popup at the top of its
			// container.
			if (idealBottom < documentHeight - 1) {
				positionBottom();
			} else if (childrenHeight < anchorLayout.anchorY - 1) {
				positionTop();
			} else {
				// Calculate the max bottom height.
				const top = anchorLayout.anchorY + anchorLayout.anchorHeight + 1;
				const maxBottomHeight = documentHeight - 4 - top;

				// Position the popup on the bottom with scrolling, if we can.
				if (maxBottomHeight > MIN_SCROLLABLE_HEIGHT) {
					positionBottom();
				} else if (anchorLayout.anchorY - 4 > MIN_SCROLLABLE_HEIGHT) {
					positionTop();
				} else {
					// Position the popup at the top of its container.
					popupLayout.top = 4;
					popupLayout.maxHeight = documentHeight - 8;
				}
			}
		}

		// Set the popup layout.
		setPopupLayout(popupLayout);
	}, [anchorLayout.anchorHeight, anchorLayout.anchorWidth, anchorLayout.anchorX, anchorLayout.anchorY, props.popupAlignment, props.popupPosition]);

	// Event handlers.
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
			const clientRect = popupRef.current.getBoundingClientRect();
			if (!(e.clientX >= clientRect.left && e.clientX <= clientRect.right &&
				e.clientY >= clientRect.top && e.clientY <= clientRect.bottom)) {
				props.renderer.dispose();
			}
		}));

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			// Get the document width and height.
			const { clientWidth: documentWidth, clientHeight: documentHeight } =
				DOM.getWindow(popupRef.current).document.documentElement;

			// Get the popup right and bottom.
			const { right: popupRight, bottom: popupBottom } =
				popupRef.current.getBoundingClientRect();

			// When resizing results in the popup being off screen, dispose of it.
			if (popupRight >= documentWidth - 4 || popupBottom >= documentHeight - 4) {
				props.renderer.dispose();
			} else if (isNumber(popupLayout.maxHeight)) {
				// Increase the max height, if possible.
				if (isNumber(popupLayout.top)) {
					// Bottom alignment.
					const maxHeight = documentHeight - 4 - popupLayout.top;
					if (maxHeight > popupLayout.maxHeight) {
						setPopupLayout({ ...popupLayout, maxHeight });
					}
				} else if (isNumber(popupLayout.bottom)) {
					// Top alignment.
					const maxHeight = anchorLayout.anchorY - 4;
					if (maxHeight > popupLayout.maxHeight) {
						setPopupLayout({ ...popupLayout, maxHeight });
					}
				}
			}
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [anchorLayout.anchorY, popupLayout, props]);

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
					...popupLayout,
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
