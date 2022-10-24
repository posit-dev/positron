/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarSeparator';
const React = require('react');

/**
 * TopBarSeparator component.
 * @returns The component.
 */
export const TopBarSeparator = () => {
	// Render.
	return (
		<div className='top-bar-separator'>
			<div className='top-bar-separator-icon codicon codicon-positron-separator' />
		</div>
	);
};
