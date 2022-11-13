/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronActionBar';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PositronActionBarProps interface.
 */
interface PositronActionBarProps {
}

/**
 * PositronActionBar component.
 * @param props A PositronActionBarProps that contains the component properties.
 */
export const PositronActionBar = (props: PropsWithChildren<PositronActionBarProps>) => {
	return (
		<div className='positron-action-bar'>
			{props.children}
		</div>
	);
};
