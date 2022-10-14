/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronContentAreaComponent';
require('react');
import * as React from 'react';

/**
 * PositronContentAreaComponent component.
 */
export const PositronContentAreaComponent = ({ children }: { children: React.ReactNode }) => {
	// Render.
	return (
		<div className='content-area'>
			{children}
		</div>
	);
};
