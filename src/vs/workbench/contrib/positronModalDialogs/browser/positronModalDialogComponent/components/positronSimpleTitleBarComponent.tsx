/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronSimpleTitleBarComponent';
require('react');
import * as React from 'react';

/**
 * PositronSimpleTitleBarComponentProps interface.
 */
interface PositronSimpleTitleBarComponentProps {
	title: string;
}

/**
 * PositronSimpleTitleBarComponent component.
 * @param props A PositronSimpleTitleBarComponentProps that contains the properties for the component.
 */
export const PositronSimpleTitleBarComponent = (props: PositronSimpleTitleBarComponentProps) => {
	// Render.
	return (
		<div className='simple-title-bar' >
			<div className='simple-title-bar-title'>
				{props.title}
			</div>
		</div>
	);
};
