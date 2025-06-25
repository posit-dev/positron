/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './horizontalGroup.css';

// React.
import React, { PropsWithChildren } from 'react';

/**
 * HorizontalGroup component.
 */
export const HorizontalGroup = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='horizontal-group'>
			{props.children}
		</div>
	);
};
