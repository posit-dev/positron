/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeExited.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemExited } from '../../../../services/positronConsole/browser/classes/runtimeItemExited.js';

// RuntimeExitedProps interface.
export interface RuntimeExitedProps {
	runtimeItemExited: RuntimeItemExited;
}

// RuntimeItemExited is write-once after construction, so memo with the default
// shallow compare on runtimeItemExited lets us skip re-renders whenever the
// parent list re-renders (e.g. on every stream chunk).
export const RuntimeExited = memo((props: RuntimeExitedProps) => {
	return (
		<div className='runtime-exited'>
			<ConsoleOutputLines outputLines={props.runtimeItemExited.outputLines} />
		</div>
	);
});
