/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
			className={positronClassNames(
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
		</div>
	);
});
