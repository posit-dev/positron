/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './contentArea.css';

// React.
import React, { PropsWithChildren } from 'react';

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
