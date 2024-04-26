/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

export interface PositronWelcomePageStartProps {

}

export const PositronWelcomePageStart = (props: PropsWithChildren<PositronWelcomePageStartProps>) => {
	// Render.
	return (
		<div className='positron-welcome-page-open welcome-page-section'>
			<h2>Start</h2>
		</div>
	);
};
