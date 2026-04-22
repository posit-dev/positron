/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStartup.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStartup } from '../../../../services/positronConsole/browser/classes/runtimeItemStartup.js';

// RuntimeStartupProps interface.
export interface RuntimeStartupProps {
	runtimeItemStartup: RuntimeItemStartup;
}

// RuntimeItemStartup is write-once after construction, so memo with the default
// shallow compare on runtimeItemStartup lets us skip re-renders whenever the
// parent list re-renders (e.g. on every stream chunk).
export const RuntimeStartup = memo((props: RuntimeStartupProps) => {
	return (
		<ConsoleOutputLines outputLines={props.runtimeItemStartup.outputLines} />
	);
});
