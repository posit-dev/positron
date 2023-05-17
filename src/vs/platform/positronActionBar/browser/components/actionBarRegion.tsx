/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarRegion';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ActionBarRegionProps interface.
 */
interface ActionBarRegionProps {
	width?: number;
	location: 'left' | 'center' | 'right';
	justify?: 'left' | 'center' | 'right';
}

/**
 * ActionBarRegionProps component.
 * @param props An ActionBarRegionProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarRegion = (props: PropsWithChildren<ActionBarRegionProps>) => {
	// Create the class names.
	const classNames = positronClassNames(
		`action-bar-region action-bar-region-${props.location}`,
		`action-bar-region-justify-${props.justify || props.location}`
	);

	// Render.
	return (
		<div className={classNames} style={{ width: optionalValue(props.width, 'auto'), minWidth: optionalValue(props.width, 'auto') }}>
			{props.children}
		</div>
	);
};
