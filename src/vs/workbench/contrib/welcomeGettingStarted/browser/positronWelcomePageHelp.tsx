/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

export interface PositronWelcomePageHelpProps {

}

export const PositronWelcomePageHelp = (props: PropsWithChildren<PositronWelcomePageHelpProps>) => {
	// Render.
	return (
		<div className='positron-welcome-page-help welcome-page-section'>
			<h2>Help</h2>
		</div>
	);
};
