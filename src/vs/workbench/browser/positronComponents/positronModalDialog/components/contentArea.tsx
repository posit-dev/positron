/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./contentArea';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

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
