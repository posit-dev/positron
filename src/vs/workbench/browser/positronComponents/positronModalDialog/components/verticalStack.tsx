/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './verticalStack.css';

// React.
import React, { PropsWithChildren } from 'react';

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
