/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import 'vs/css!./css/buttonComponent';
const React = require('react');

/**
 * ButtonComponentProps interface.
 */
interface ButtonComponentProps {
	dropDown?: boolean;
	classNameBackground: string;
}

/**
 * ButtonComponent component.
 * @param props A ButtonComponentProps that contains the component properties.
 * @returns The component.
 */
export const ButtonComponent = (props: ButtonComponentProps) => {
	// Hooks.
	const [hover, setHover] = useState(false);

	const clickHandler = () => {
		console.log('Button was clicked');
	};

	const mouseEnterHandler = () => {
		console.log('Mouse is inside button!');
		setHover(true);
	};

	const mouseLeaveHandler = () => {
		console.log('Mouse is outside button!');
		setHover(false);
	};


	// Render.
	return (
		<div className='button-component' onClick={clickHandler} onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
			<div className='button-face'>
				<div className={`button-background ${props.classNameBackground}`} />
				{props.dropDown && <div className='button-drop-down-arrow' />}
				{hover && <div className='toolie'>Hello</div>}
			</div>
		</div>
	);
};
