/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeOffline.css';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
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
			<ConsoleOutputLines outputLines={props.runtimeItemOffline.outputLines} />
		</div>
	);
};
