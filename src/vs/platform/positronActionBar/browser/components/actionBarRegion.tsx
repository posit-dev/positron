/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarRegion.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { optionalValue, positronClassNames } from '../../../../base/common/positronUtilities.js';

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
