/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyConsole';
import * as React from 'react';
import { localize } from 'vs/nls';

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const EmptyConsole = () => {
	// Render.
	return (
		<div className='empty-console'>
			<div className='title'>{localize('positronNoInterpreterRunning', "There is no interpreter currently running.")}</div>
		</div>
	);
};
