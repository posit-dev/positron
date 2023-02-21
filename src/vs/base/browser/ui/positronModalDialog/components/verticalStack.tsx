/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./verticalStack';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line

/**
 * VerticalStack component.
 */
export const VerticalStack = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='vertical-stack'>
			{props.children}
		</div>
	);
};
