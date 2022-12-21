/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronListItem';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PositronListItemProps interface.
 */
export interface PositronListItemProps {
	top: number;
	height: number;
}

/**
 * PositronListItem component.
 * @param props A PositronListItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronListItem = (props: PropsWithChildren<PositronListItemProps>) => {
	// Render.
	return (
		<div className='positron-list-item' style={{ left: 0, top: props.top, height: props.height }}>
			{props.children}
		</div>
	);
};
