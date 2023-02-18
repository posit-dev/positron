/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarRegion';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { optionalValue } from 'vs/base/common/positronUtilities';

/**
 * ActionBarRegionProps interface.
 */
interface ActionBarRegionProps {
	align: 'left' | 'center' | 'right';
	gap?: number;
}

/**
 * ActionBarRegionProps component.
 * @param props An ActionBarRegionProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarRegion = (props: PropsWithChildren<ActionBarRegionProps>) => {
	// Render.
	return (
		<div className={`action-bar-region action-bar-region-${props.align}`} style={{ gap: optionalValue(props.gap, 0) }}>
			{props.children}
		</div>
	);
};
