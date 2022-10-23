/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarRegion';
import { PropsWithChildren } from 'react';
const React = require('react');

/**
 * TopBarRegionProps interface.
 */
interface TopBarRegionProps {
	align: 'left' | 'center' | 'right';
}

/**
 * TopBarRegionProps component.
 * @param props A TopBarRegionProps that contains the component properties.
 * @returns The component.
 */
export const TopBarRegion = (props: PropsWithChildren<TopBarRegionProps>) => {

	// Render.
	return (
		<div className={`top-bar-region top-bar-region-${props.align}`}>
			{props.children}
		</div>
	);
};
