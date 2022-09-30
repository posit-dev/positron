/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contentAreaComponent';
require('react');
import * as React from 'react';

/**
 * ContentAreaComponent component.
 */
export const ContentAreaComponent = ({ children }: { children: React.ReactNode }) => {
	// Render.
	return (
		<div className='content-area'>
			{children}
		</div>
	);
};
