/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronActionBar';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * PositronActionBarProps interface.
 */
interface PositronActionBarProps {
	size: 'small' | 'large';
	gap?: number;
	borderTop?: boolean;
	borderBottom?: boolean;
	paddingLeft?: number;
	paddingRight?: number;
}

/**
 * PositronActionBar component.
 * @param props A PositronActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronActionBar = (props: PropsWithChildren<PositronActionBarProps>) => {
	// Create the class names.
	const classNames = positronClassNames(
		'positron-action-bar',
		{ 'border-top': props?.borderTop },
		{ 'border-bottom': props?.borderBottom },
		props.size
	);

	// Render.
	return (
		<div className={classNames} style={{ gap: optionalValue(props.gap, 0), paddingLeft: optionalValue(props.paddingLeft, 0), paddingRight: optionalValue(props.paddingRight, 0) }}>
			{props.children}
		</div>
	);
};
