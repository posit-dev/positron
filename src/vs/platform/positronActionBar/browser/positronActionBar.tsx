/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronActionBar';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronClassNames';

/**
 * PositronActionBarProps interface.
 */
interface PositronActionBarProps {
	size: 'small' | 'large';
	gap?: number;
	borderTop?: boolean;
	borderBottom?: boolean;
	paddingLeft: number;
	paddingRight: number;
}

/**
 * PositronActionBar component.
 * @param props A PositronActionBarProps that contains the component properties.
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
		<div className={classNames} style={{ gap: props.gap !== undefined ? props.gap : 0, paddingLeft: props.paddingLeft, paddingRight: props.paddingRight }}>
			{props.children}
		</div>
	);
};
