/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contentArea';
require('react');
import * as React from 'react';

/**
 * ContentArea component.
 */
export const ContentArea = ({ children }: { children: React.ReactNode }) => {
	// Render.
	return (
		<div className='content-area'>
			{children}
		</div>
	);
};
