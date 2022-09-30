/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./titleBarComponent';
const React = require('react');
import { useEffect } from 'react';

/**
 * SimpleTitleBarProps interface.
 */
interface SimpleTitleBarProps {
	title: string;
}

/**
 * SimpleTitleBarComponent component.
 * @param props A SimpleTitleBarProps that contains the properties for the simple title bar.
 */
export const SimpleTitleBarComponent = (props: SimpleTitleBarProps) => {
	useEffect(() => {
	}, []);
	// Render.
	return (
		<div className='title-bar' >
			<div className='title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
