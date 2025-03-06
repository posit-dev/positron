/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalPopup.css';

// React.
import React, { PropsWithChildren, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { isNumber } from '../../../../base/common/types.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { PositronModalReactRenderer } from '../../positronModalReactRenderer/positronModalReactRenderer.js';

/**
 * Constants.
 */
const LAYOUT_OFFSET = 2;
const LAYOUT_MARGIN = 10;

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
 * PopupLayout class.
 */
class PopupLayout {
	top: number | 'auto' = 'auto';
	right: number | 'auto' = 'auto';
	bottom: number | 'auto' = 'auto';
	left: number | 'auto' = 'auto';
	width: number | 'auto' = 'auto';
	height: number | 'auto' = 'auto';
	maxWidth: number | 'none' = 'none';
	maxHeight: number | 'none' = 'none';
	shadow: 'top' | 'bottom' = 'bottom';
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
export type PopupPosition = 'bottom' | 'top' | 'auto';

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
	readonly width: number | 'auto';
	readonly minWidth?: number | 'auto';
	readonly height: number | 'auto';
	readonly minHeight?: number | 'auto';
	readonly maxHeight?: number | 'none';
	readonly fixedHeight?: boolean;
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
	// Reference hooks.
	const popupContainerRef = useRef<HTMLDivElement>(undefined!);
	const popupRef = useRef<HTMLDivElement>(undefined!);
	const popupChildrenRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [popupLayout, setPopupLayout] = useState<PopupLayout>(() => {
		// Initially, position the popup off screen.
		const popupLayout = new PopupLayout();
		popupLayout.left = -10000;
		popupLayout.top = -10000;
		return popupLayout;
	});

	/**
	 * Updates the popup layout.
	 */
	const updatePopupLayout = useCallback(() => {
		// Get the document width and height.
		const { clientWidth: documentWidth, clientHeight: documentHeight } =
			DOM.getWindow(popupRef.current).document.documentElement;

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

		// Calculate the left and right area widths. This is the space that is available for laying
		// out the modal popup anchored to the left or right of the anchor point or element.
		const leftAreaWidth = anchorX + anchorWidth - LAYOUT_MARGIN;
		const rightAreaWidth = documentWidth - anchorX - LAYOUT_MARGIN;

		// Create the popup layout.
		const popupLayout = new PopupLayout();

		/**
		 * Positions the popup aligned with the left edge of the anchor element.
		 */
		const positionLeft = () => {
			popupLayout.left = anchorX;
		};

		/**
		 * Positions the popup aligned with the right edge of the anchor element.
		 */
		const positionRight = () => {
			if (isNumber(props.width)) {
				popupLayout.left = (anchorX + anchorWidth) - props.width;
			} else {
				popupLayout.right = documentWidth - (anchorX + anchorWidth);
			}
		};

		// Perform horizontal popup layout.
		if (props.popupAlignment === 'left') {
			positionLeft();
		} else if (props.popupAlignment === 'right') {
			positionRight();
		} else if (props.popupAlignment === 'auto') {
			if (leftAreaWidth > rightAreaWidth) {
				positionRight();
			} else {
				positionLeft();
			}
		}

		// Calculate the top and bottom area heights. This is the space that is available for laying
		// out the modal popup anchored to the top or bottom of the anchor point or element.
		const topAreaHeight = anchorY - LAYOUT_OFFSET - LAYOUT_MARGIN;
		const bottomAreaHeight = documentHeight -
			(anchorY + anchorHeight + LAYOUT_OFFSET + LAYOUT_MARGIN);

		// Perform vertical popup layout.
		if (props.height === 'auto') {
			// Set the popup layout height.
			popupLayout.height = props.height;

			// Calculate the layout height. (Adding 2 for the border.)
			const layoutHeight = popupChildrenRef.current.offsetHeight + 2;

			// Position the popup at the bottom.
			const positionBottom = () => {
				popupLayout.top = anchorY + anchorHeight + LAYOUT_OFFSET;
				if (props.fixedHeight) {
					popupLayout.top = Math.min(popupLayout.top, documentHeight - layoutHeight - LAYOUT_MARGIN);
				} else {
					popupLayout.maxHeight = documentHeight - popupLayout.top - LAYOUT_MARGIN;
				}
				popupLayout.shadow = 'bottom';
			};

			// Position the popup at the top.
			const positionTop = () => {
				const drawHeight = Math.min(topAreaHeight, layoutHeight);
				popupLayout.top = Math.max(anchorY - drawHeight - LAYOUT_OFFSET, LAYOUT_MARGIN);
				popupLayout.maxHeight = drawHeight;
				popupLayout.shadow = 'top';
			};

			// Adjust the popup layout for the popup position.
			if (props.popupPosition === 'bottom') {
				positionBottom();
			} else if (props.popupPosition === 'top') {
				positionTop();
			} else {
				if (layoutHeight <= bottomAreaHeight) {
					positionBottom();
				} else if (layoutHeight <= topAreaHeight) {
					positionTop();
				} else {
					if (bottomAreaHeight > topAreaHeight) {
						positionBottom();
					} else {
						positionTop();
					}
				}
			}
		} else {
			// Set the popup layout height.
			popupLayout.height = props.height;

			// Position the popup at the bottom.
			const positionBottom = () => {
				popupLayout.top = anchorY + anchorHeight + LAYOUT_OFFSET;
				popupLayout.maxHeight = bottomAreaHeight;
				popupLayout.shadow = 'bottom';
			};

			// Position the popup at the top.
			const positionTop = (height: number) => {
				const drawHeight = Math.min(topAreaHeight, height);
				popupLayout.top = anchorY - drawHeight - LAYOUT_OFFSET;
				popupLayout.maxHeight = drawHeight;//topAreaHeight;
				popupLayout.shadow = 'top';
			};

			// Adjust the popup layout for the popup position.
			if (props.popupPosition === 'bottom') {
				positionBottom();
			} else if (props.popupPosition === 'top') {
				positionTop(props.height);
			} else {
				if (bottomAreaHeight > topAreaHeight) {
					positionBottom();
				} else {
					positionTop(props.height);
				}
			}
		}

		// Set the popup layout.
		setPopupLayout(popupLayout);
	}, [props.anchorElement, props.anchorPoint, props.height, props.popupAlignment, props.popupPosition, props.width, props.fixedHeight]);

	// Layout.
	useLayoutEffect(() => {
		updatePopupLayout();
	}, [updatePopupLayout]);

	// Event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			// On resize, update the layout.
			updatePopupLayout();
		}));

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

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [props, updatePopupLayout]);

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
				className={positronClassNames(
					'positron-modal-popup',
					popupLayout.shadow === 'top' ? 'shadow-top' : 'shadow-bottom'
				)}
				style={{
					...popupLayout,
					width: props.width
				}}
			>
				<div ref={popupChildrenRef} className='positron-modal-popup-children'>
					{props.children}
				</div>
			</div>
		</div>
	);
};
