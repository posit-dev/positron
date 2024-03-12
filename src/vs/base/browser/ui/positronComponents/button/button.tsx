/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./button';


// React.
import * as React from 'react';
import { forwardRef, KeyboardEvent, MouseEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';

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
 * Button component.
 * @param props A PropsWithChildren<Props> that contains the component properties.
 * @returns The rendered component.
 */
export const Button = forwardRef<HTMLButtonElement, PropsWithChildren<Props>>((props, ref) => {
	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = (e: KeyboardEvent<HTMLButtonElement>) => {
		// Process the key down event.
		switch (e.code) {
			// Space or Enter trigger the onPressed event.
			case 'Space':
			case 'Enter':
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
	const clickHandler = (e: MouseEvent<HTMLButtonElement>) => {
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
	const mouseDownHandler = (e: MouseEvent<HTMLButtonElement>) => {
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
		<button
			ref={ref}
			className={positronClassNames(
				'button',
				props.className,
				{ 'disabled': props.disabled }
			)}
			tabIndex={0}
			role='button'
			aria-label={props.ariaLabel}
			aria-disabled={props.disabled ? 'true' : undefined}
			onKeyDown={keyDownHandler}
			onClick={clickHandler}
			onMouseDown={mouseDownHandler}
		>
			{props.children}
		</button>
	);
});
