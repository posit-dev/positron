/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarCommandCenter';

const React = require('react');

/**
 * TopBarCommandCenterProps interface.
 */
interface TopBarCommandCenterProps {

}

/**
 * TopBarCommandCenter component.
 * @param props A TopBarCommandCenterProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandCenter = (props: TopBarCommandCenterProps) => {

	// Render.
	return (
		<div className={`top-bar-command-center`}>
			<div className='top-bar-command-center-search'>
				<span className='codicon codicon-search'></span>
				<span>Search</span>
			</div>

			<div className='top-bar-command-center-chevron'>
				<span className='codicon codicon-chevron-down'></span>
			</div>
		</div>
	);
};
