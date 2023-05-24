/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronModalPopup';
import * as React from 'react';
import { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import * as DOM from 'vs/base/browser/dom';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * Event aliases.
 */
type Position = DOM.IDomPosition;
type UIEvent = globalThis.UIEvent;
type MouseEvent = globalThis.MouseEvent;
type KeyboardEvent = globalThis.KeyboardEvent;

/**
 * PopupPosition type.
 */
export type PopupPosition = 'top' | 'bottom';

/**
 * PopupAlignment type.
 */
export type PopupAlignment = 'left' | 'right';

/**
 * PositronModalPopupProps interface.
 */
export interface PositronModalPopupProps {
	anchorElement: HTMLElement;
	popupPosition: PopupPosition;
	popupAlignment: PopupAlignment;
	width: number;
	height: number | 'min-content';
	dismiss: () => void;
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
				topLeftOffset.top - popupRef.current.offsetHeight - 1 :
				topLeftOffset.top + props.anchorElement.offsetHeight + 1,
			left: props.popupAlignment === 'left' ?
				topLeftOffset.left :
				topLeftOffset.left + props.anchorElement.offsetWidth - props.width
		};
	};

	// Reference hooks.
	const popupContainerRef = useRef<HTMLDivElement>(undefined!);
	const popupRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [position, setPosition] = useState<Position>(computePosition());

	// Memoize the keydown event handler.
	const keydownHandler = useCallback((e: KeyboardEvent) => {
		/**
		 * Consumes an event.
		 */
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Handle the event.
		switch (e.key) {
			// Escape dismisses the modal popup.
			case 'Escape':
				consumeEvent();
				props.dismiss();
				break;

			// Allow tab so the user can set focus to the UI elements in the modal popup.
			case 'Tab':
				break;

			// Allow space and enter so buttons in the modal popup can be pressed.
			case 'Space':
			case 'Enter':
				break;

			// Eat other keys.
			default:
				consumeEvent();
				break;
		}
	}, []);

	// Memoize the mousedownHandler.
	const mousedownHandler = useCallback((e: MouseEvent) => {
		if (!popupContainsMouseEvent(e)) {
			props.dismiss();
		}
	}, []);

	// Memoize the resizeHandler.
	const resizeHandler = useCallback((e: UIEvent) => {
		setPosition(computePosition());
	}, []);

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

	// Initialization.
	useEffect(() => {
		// Add our event handlers.
		const KEYDOWN = 'keydown';
		const MOUSEDOWN = 'mousedown';
		const RESIZE = 'resize';
		document.addEventListener(KEYDOWN, keydownHandler, true);
		window.addEventListener(MOUSEDOWN, mousedownHandler, false);
		window.addEventListener(RESIZE, resizeHandler, false);

		// Drive focus to the popup.
		popupContainerRef.current.focus();

		// Return the cleanup function that removes our event handlers.
		return () => {
			document.removeEventListener(KEYDOWN, keydownHandler, true);
			window.removeEventListener(MOUSEDOWN, mousedownHandler, false);
			window.removeEventListener(RESIZE, resizeHandler, false);
		};
	}, []);

	// Create the class names.
	const classNames = positronClassNames(
		'positron-modal-popup',
		props.popupPosition === 'top' ? 'shadow-top' : 'shadow-bottom'
	);

	// Render.
	return (
		<div className='positron-modal-popup-shadow-container'>
			<div ref={popupContainerRef} className='positron-modal-popup-container' role='dialog' tabIndex={-1}>
				<div ref={popupRef} className={classNames} style={{ top: position.top, left: position.left, width: props.width, height: props.height }}>
					{props.children}
				</div>
			</div>
		</div>
	);
};
