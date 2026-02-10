/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronRuntimeSessionsContext } from '../positronRuntimeSessionsContext.js';

// Constants.
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<{}>) => {
	// Context hooks.
	const positronSessionsContext = usePositronRuntimeSessionsContext();

	// If there are no instances, return null.
	if (positronSessionsContext.positronSessions.size === 0) {
		return null;
	}

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					{positronSessionsContext.positronSessions.size} sessions
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
