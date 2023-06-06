/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { KeyboardEvent, MouseEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * PositronButtonProps interface.
 */
interface PositronButtonProps {
	inline?: boolean;
	className?: string;
	disabled?: boolean;
	onClick: () => void;
}

/**
 * PositronButton component. This component is intentionally unstyled.
 * @param props A PropsWithChildren<PositronButtonProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronButton = (props: PropsWithChildren<PositronButtonProps>) => {
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

				// Raise the click event if the button isn't disabled.
				if (!props.disabled) {
					props.onClick();
				}
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

		// Raise the click event if the button isn't disabled.
		if (!props.disabled) {
			props.onClick();
		}
	};

	// Generate the class names.
	const classNames = positronClassNames(props.className, { 'disabled': props.disabled });

	// Render inline.
	if (props.inline) {
		return (
			<span
				className={classNames}
				tabIndex={0}
				role='button'
				onKeyDown={keyDownHandler}
				onClick={clickHandler}>
				{props.children}
			</span>
		);
	}

	// Render.
	return (
		<div
			className={classNames}
			tabIndex={0}
			role='button'
			onKeyDown={keyDownHandler}
			onClick={clickHandler}>
			{props.children}
		</div>
	);
};
