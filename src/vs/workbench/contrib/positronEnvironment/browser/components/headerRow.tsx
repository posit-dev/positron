/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./headerRow';
import * as React from 'react';

/**
 * HeaderRowProps interface.
 */
interface HeaderRowProps {
	title: string;
}

/**
 * HeaderRow component.
 * @returns The rendered component.
 */
export const HeaderRow = (props: HeaderRowProps) => {
	// Render.
	return (
		<div className='header-row not-selectable'>
			{props.title}
		</div>
	);
};
