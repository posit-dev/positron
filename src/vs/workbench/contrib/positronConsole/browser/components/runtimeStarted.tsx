/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStarted.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStarted } from '../../../../services/positronConsole/browser/classes/runtimeItemStarted.js';

// RuntimeStartedProps interface.
export interface RuntimeStartedProps {
	runtimeItemStarted: RuntimeItemStarted;
}

// RuntimeItemStarted is write-once after construction, so memo with the default
// shallow compare on runtimeItemStarted lets us skip re-renders whenever the
// parent list re-renders (e.g. on every stream chunk).
export const RuntimeStarted = memo((props: RuntimeStartedProps) => {
	return (
		<ConsoleOutputLines outputLines={props.runtimeItemStarted.outputLines} />
	);
});
