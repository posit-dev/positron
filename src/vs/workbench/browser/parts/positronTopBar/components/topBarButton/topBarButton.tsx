/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import 'vs/css!./css/topBarButton';
const React = require('react');

/**
 * TopBarButtonProps interface.
 */
interface TopBarButtonProps {
	dropDown?: boolean;
	iconClassName: string;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = (props: TopBarButtonProps) => {
	// Hooks.
	const [hover, setHover] = useState(false);

	// Handlers.
	const clickHandler = () => {
		console.log('Button was clicked');
	};

	const mouseEnterHandler = () => {
		console.log('Mouse is inside button!');
		// setHover(true);
		setHover(false);
	};

	const mouseLeaveHandler = () => {
		console.log('Mouse is outside button!');
		setHover(false);
	};

	// Render.
	return (
		<div className='top-bar-button' onClick={clickHandler} onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
			<div className='top-bar-button-face'>
				<div className={`top-bar-button-icon ${props.iconClassName}`} />
				{props.dropDown && <div className='top-bar-button-drop-down-arrow' />}
				{hover && <div className='toolie'>Hello</div>}
			</div>
		</div>
	);
};
