/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarRegion';

const React = require('react');

/**
 * TopBarRegionProps interface.
 */
interface TopBarRegionProps {
	align: 'left' | 'center' | 'right';
	children: React.ReactNode;
}

/**
 * TopBarRegionProps component.
 * @param props A TopBarRegionProps that contains the component properties.
 * @returns The component.
 */
export const TopBarRegion = (props: TopBarRegionProps) => {

	// Render.
	return (
		<div className={`top-bar-region top-bar-region-${props.align}`}>
			{props.children}
		</div>
	);
};
