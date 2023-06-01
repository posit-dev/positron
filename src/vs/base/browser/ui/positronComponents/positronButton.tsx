/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { KeyboardEvent, MouseEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PositronButtonProps interface.
 */
interface PositronButtonProps {
	onClick: () => void;
}

/**
 * PositronButton component. This component is intentionally unstyled.
 * @param props A PropsWithChildren<PositronButtonProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronButton = ({ onClick, children }: PropsWithChildren<PositronButtonProps>) => {
	/**
	 * onKeyDown event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const keyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		switch (e.code) {
			case 'Space':
			case 'Enter':
				// Consume the event.
				e.preventDefault();
				e.stopPropagation();

				// Raise the click event.
				onClick();
				break;
		}
	};

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Raise the click event.
		onClick();
	};

	// Render.
	return (
		<div className='positron-button' tabIndex={0} role='button' onKeyDown={keyDownHandler} onClick={clickHandler}>
			{children}
		</div>
	);
};
