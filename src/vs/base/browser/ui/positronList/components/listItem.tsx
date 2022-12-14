/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./listItem';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * ListItemProps interface.
 */
export interface ListItemProps {
	top: number;
	height: number;
}

/**
 * ListItem component.
 * @param props A ListItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const ListItem = (props: PropsWithChildren<ListItemProps>) => {
	// Render.
	return (
		<div className='list-item' style={{ left: 0, top: props.top, height: props.height, width: '100%' }}>
			{props.children}
		</div>
	);
};
