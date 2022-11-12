/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarRegion';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * ActionBarRegionProps interface.
 */
interface ActionBarRegionProps {
	align: 'left' | 'center' | 'right';
}

/**
 * ActionBarRegionProps component.
 * @param props An ActionBarRegionProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarRegion = (props: PropsWithChildren<ActionBarRegionProps>) => {

	// Render.
	return (
		<div className={`action-bar-region top-bar-region-${props.align}`}>
			{props.children}
		</div>
	);
};
