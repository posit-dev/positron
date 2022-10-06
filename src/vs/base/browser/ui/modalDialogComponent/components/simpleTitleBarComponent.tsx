/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./simpleTitleBarComponent';
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
 * @param props A SimpleTitleBarComponentProps that contains the properties for the component.
 */
export const SimpleTitleBarComponent = (props: SimpleTitleBarComponentProps) => {
	// Render.
	return (
		<div className='simple-title-bar' >
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
