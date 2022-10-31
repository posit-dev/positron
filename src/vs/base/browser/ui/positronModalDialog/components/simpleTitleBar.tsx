/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./simpleTitleBar';
import * as React from 'react';

/**
 * SimpleTitleBarProps interface.
 */
interface SimpleTitleBarProps {
	title: string;
}

/**
 * SimpleTitleBar component.
 * @param props A SimpleTitleBarProps that contains the properties for the component.
 */
export const SimpleTitleBar = (props: SimpleTitleBarProps) => {
	// Render.
	return (
		<div className='simple-title-bar' >
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
