/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
export const PositronListItem = ({ top, height, children }: PropsWithChildren<PositronListItemProps>) => {
	// Render.
	return (
		<div className='positron-list-item' style={{ position: 'absolute', left: 0, top, right: 0, height, background: height === 25 ? '#ffffff' : '#f0f0f0' }}>
			{children}
		</div>
	);
};
