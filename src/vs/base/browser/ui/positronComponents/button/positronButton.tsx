/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { forwardRef, KeyboardEvent, MouseEvent, PropsWithChildren } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../common/positronUtilities.js';

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
 * Props interface.
 */
interface Props {
	className?: string;
	disabled?: boolean;
	ariaLabel?: string;
	mouseTrigger?: MouseTrigger;
	onPressed?: (e: KeyboardModifiers) => void;
}

/**
 * PositronButton component. This component is intentionally unstyled.
 * @param props A PropsWithChildren<Props> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronButton = forwardRef<HTMLDivElement, PropsWithChildren<Props>>((props, ref) => {
	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		// Process the key down event.
		switch (e.code) {
			// Space triggers the onPressed event. Note: Do not add 'Enter' here. Enter is reserved
			// for clicking the default button in modal popups and modal dialogs.
			case 'Space':
				// Consume the event.
				e.preventDefault();
				e.stopPropagation();

				// Raise the onPressed event if the button isn't disabled.
				if (!props.disabled && props.onPressed) {
					props.onPressed(e);
				}
				break;
		}
	};

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		// If the mouse trigger is click, handle the event.
		if (props.mouseTrigger === undefined || props.mouseTrigger === MouseTrigger.Click) {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Raise the onPressed event if the button isn't disabled.
			if (!props.disabled && props.onPressed) {
				props.onPressed(e);
			}
		}
	};

	/**
	 * onMouseDown event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// If the mouse trigger is mouse down, handle the event.
		if (props.mouseTrigger === MouseTrigger.MouseDown) {
			// Consume the event.
			e.preventDefault();
			e.stopPropagation();

			// Raise the onPressed event if the button isn't disabled.
			if (!props.disabled && props.onPressed) {
				props.onPressed(e);
			}
		}
	};

	// Render.
	return (
		<div
			ref={ref}
			aria-disabled={props.disabled ? 'true' : undefined}
			aria-label={props.ariaLabel}
			className={positronClassNames(
				props.className,
				{ 'disabled': props.disabled }
			)}
			role='button'
			tabIndex={0}
			onClick={clickHandler}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
		>
			{props.children}
		</div>
	);
});

// Set the display name.
PositronButton.displayName = 'PositronButton';
