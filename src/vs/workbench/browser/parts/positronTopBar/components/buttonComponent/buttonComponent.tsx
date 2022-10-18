/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/buttonComponent';
const React = require('react');

/**
 * ButtonComponentProps interface.
 */
interface ButtonComponentProps {
	classNameBackground: string;
}

/**
 * ButtonComponent component.
 * @param props A ButtonComponentProps that contains the component properties.
 * @returns The component.
 */
export const ButtonComponent = (props: ButtonComponentProps) => {
	const clickHandler = () => {
		console.log('Button was clicked');
	};

	// Render.
	return (
		<div className='button-component' onClick={clickHandler}>
			<div className='button-face'>
				<div className={`button-background ${props.classNameBackground}`} />
			</div>
		</div>
	);
};
