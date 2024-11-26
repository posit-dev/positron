/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './runtimeOffline.css';
import * as React from 'react';
import { OutputLines } from './outputLines.js';
import { RuntimeItemOffline } from '../../../../services/positronConsole/browser/classes/runtimeItemOffline.js';

// RuntimeExitedProps interface.
export interface RuntimeOfflineProps {
	runtimeItemOffline: RuntimeItemOffline;
}

/**
 * RuntimeOffline component.
 * @param props A RuntimeOfflineProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeOffline = (props: RuntimeOfflineProps) => {
	// Render.
	return (
		<div className='runtime-offline'>
			<OutputLines outputLines={props.runtimeItemOffline.outputLines} />
		</div>
	);
};
