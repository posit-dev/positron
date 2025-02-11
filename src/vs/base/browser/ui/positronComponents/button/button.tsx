/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './button.css';

// React.
import React, { CSSProperties, forwardRef, KeyboardEvent, MouseEvent, PropsWithChildren, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../common/positronUtilities.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';

/**
 * MouseTrigger enumeration.
 */
export enum MouseTrigger {
	Click,
	MouseDown
}

/**
 * KeyboardModifiers interface.
 */
export interface KeyboardModifiers {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/**
 * ButtonProps interface.
 */
interface ButtonProps {
	readonly hoverManager?: IHoverManager;
	readonly className?: string;
	readonly style?: CSSProperties | undefined;
	readonly tabIndex?: number;
	readonly disabled?: boolean;
	readonly ariaLabel?: string;
	readonly tooltip?: string | (() => string | undefined);
	readonly mouseTrigger?: MouseTrigger;
	readonly onBlur?: () => void;
	readonly onFocus?: () => void;
	readonly onMouseEnter?: () => void;
	readonly onMouseLeave?: () => void;
	readonly onPressed?: (e: KeyboardModifiers) => void;
}

/**
 * Button component.
 * @param props A PropsWithChildren<ButtonProps> that contains the component properties.
 * @returns The rendered component.
 */
export const Button = forwardRef<HTMLButtonElement, PropsWithChildren<ButtonProps>>((props, ref) => {
	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Customize the ref handle that is exposed.
	useImperativeHandle(ref, () => buttonRef.current, []);

	// State hooks.
	const [mouseInside, setMouseInside] = useState(false);

	// Hover useEffect.
	React.useEffect(() => {
		// If the mouse is inside, show the hover. This has the effect of showing the hover when
		// mouseInside is set to true and updating the hover when the tooltip changes.
		if (mouseInside) {
			props.hoverManager?.showHover(buttonRef.current, props.tooltip);
		}
	}, [mouseInside, props.hoverManager, props.tooltip]);

	/**
	 * Sends the onPressed event.
	 * @param e The event that triggered the onPressed event.
	 */
	const sendOnPressed = (e: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Hide the hover.
		props.hoverManager?.hideHover();

		// Raise the onPressed event if the button isn't disabled.
		if (!props.disabled && props.onPressed) {
			props.onPressed(e);
		}
	};

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = (e: KeyboardEvent<HTMLButtonElement>) => {
		// Process the key down event.
		switch (e.code) {
			// Space triggers the onPressed event. Note: Do not add 'Enter' here. Enter is reserved
			// for clicking the default button in modal popups and modal dialogs.
			case 'Space':
				sendOnPressed(e);
				break;
		}
	};

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// If the mouse trigger is click, handle the event.
		if (props.mouseTrigger === undefined || props.mouseTrigger === MouseTrigger.Click) {
			sendOnPressed(e);
		}
	};

	/**
	 * onMouseEnter event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const mouseEnterHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Set the mouse inside state.
		setMouseInside(true);

		// Call the onMouseEnter callback.
		props.onMouseEnter?.();
	};

	/**
	 * onMouseLeave event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const mouseLeaveHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Clear the mouse inside state.
		setMouseInside(false);

		// Hide the hover.
		props.hoverManager?.hideHover();

		// Call the onMouseLeave callback.
		props.onMouseLeave?.();
	};

	/**
	 * onMouseDown event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event. This addresses https://github.com/posit-dev/positron/issues/5737 and
		// was borrowed from ActionViewItem.
		e.preventDefault();
		e.stopPropagation();

		// If the mouse trigger is mouse down, handle the event.
		if (props.mouseTrigger === MouseTrigger.MouseDown) {
			sendOnPressed(e);
		}
	};

	// Render.
	return (
		<button
			ref={buttonRef}
			aria-disabled={props.disabled ? 'true' : undefined}
			aria-label={props.ariaLabel}
			className={positronClassNames(
				'positron-button',
				props.className,
				{ 'disabled': props.disabled }
			)}
			disabled={props.disabled}
			role='button'
			style={props.style}
			tabIndex={props.tabIndex ?? 0}
			onBlur={props.onBlur}
			onClick={clickHandler}
			onFocus={props.onFocus}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
			onMouseEnter={mouseEnterHandler}
			onMouseLeave={mouseLeaveHandler}
		>
			{props.children}
		</button>
	);
});

// Set the display name.
Button.displayName = 'Button';
