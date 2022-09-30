/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contentAreaComponent';
const React = require('react');
import { useEffect } from 'react';

/**
 * ContentAreaComponent component.
 */
export const ContentAreaComponent = ({ children }: { children: React.ReactNode }) => {
	// Hooks.
	useEffect(() => {
	}, []);

	// Render.
	return (
		<div className='content-area'>
			{children}
		</div>
	);
};
