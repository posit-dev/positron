/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./verticalSpacer';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line

/**
 * VerticalSpacer component.
 */
export const VerticalSpacer = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='vertical-spacer'>
			{props.children}
		</div>
	);
};
