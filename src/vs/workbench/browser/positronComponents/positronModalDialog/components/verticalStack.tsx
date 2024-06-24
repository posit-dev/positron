/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./verticalStack';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

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
