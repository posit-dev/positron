/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contentArea';
const React = require('react');
import { PropsWithChildren } from 'react';

/**
 * ContentArea component.
 */
export const ContentArea = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='content-area'>
			{props.children}
		</div>
	);
};
