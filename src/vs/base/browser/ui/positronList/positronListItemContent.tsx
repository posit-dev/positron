/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronListItemContent';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PositronListItemContentProps interface.
 */
export interface PositronListItemContentProps {
}

/**
 * PositronListItemContent component.
 * @param props A PositronListItemContentProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronListItemContent = (props: PropsWithChildren<PositronListItemContentProps>) => {
	// Render.
	return (
		<div className='positron-list-item-content'>
			{props.children}
		</div>
	);
};
