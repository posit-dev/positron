/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./verticalSpacer';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

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
