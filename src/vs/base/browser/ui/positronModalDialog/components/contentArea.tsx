/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contentArea';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line

/**
 * ContentArea component.
 */
export const ContentArea = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='content-area'>
			{props.children}
		</div>
	);
};
