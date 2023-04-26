/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyConsole';
import * as React from 'react';

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const EmptyConsole = () => {
	// Render.
	return (
		<div className='empty-console'>
			<div className='title'>There is no runtime currently available.</div>
		</div>
	);
};
