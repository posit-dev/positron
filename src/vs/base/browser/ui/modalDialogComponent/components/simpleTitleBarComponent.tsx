/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./titleBarComponent';
require('react');
import * as React from 'react';

/**
 * SimpleTitleBarComponentProps interface.
 */
interface SimpleTitleBarComponentProps {
	title: string;
}

/**
 * SimpleTitleBarComponent component.
 * @param props A SimpleTitleBarProps that contains the properties for the simple title bar.
 */
export const SimpleTitleBarComponent = (props: SimpleTitleBarComponentProps) => {
	// Render.
	return (
		<div className='title-bar' >
			<div className='title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
