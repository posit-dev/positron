/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarSeparator';
import * as React from 'react';

/**
 * ActionBarSeparator component.
 * @returns The component.
 */
export const ActionBarSeparator = () => {
	// Render.
	return (
		<div className='action-bar-separator' aria-hidden='true' >
			<div className='action-bar-separator-icon codicon codicon-positron-separator' />
		</div>
	);
};
