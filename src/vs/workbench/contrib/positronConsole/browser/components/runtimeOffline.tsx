/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeOffline.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemOffline } from '../../../../services/positronConsole/browser/classes/runtimeItemOffline.js';

// RuntimeExitedProps interface.
export interface RuntimeOfflineProps {
	runtimeItemOffline: RuntimeItemOffline;
}

// RuntimeItemOffline is write-once after construction, so memo with the default
// shallow compare on runtimeItemOffline lets us skip re-renders whenever the
// parent list re-renders (e.g. on every stream chunk).
export const RuntimeOffline = memo((props: RuntimeOfflineProps) => {
	return (
		<div className='runtime-offline'>
			<ConsoleOutputLines outputLines={props.runtimeItemOffline.outputLines} />
		</div>
	);
});
