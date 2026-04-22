/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStartupFailure.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStartupFailure } from '../../../../services/positronConsole/browser/classes/runtimeItemStartupFailure.js';

// RuntimeStartupFailureProps interface.
export interface RuntimeStartupFailureProps {
	runtimeItemStartupFailure: RuntimeItemStartupFailure;
}

// RuntimeItemStartupFailure is write-once after construction, so memo with the
// default shallow compare on runtimeItemStartupFailure lets us skip re-renders
// whenever the parent list re-renders (e.g. on every stream chunk).
export const RuntimeStartupFailure = memo((props: RuntimeStartupFailureProps) => {
	return (
		<div className='runtime-startup-failure'>
			<div className='message'>{props.runtimeItemStartupFailure.message}</div>
			<ConsoleOutputLines outputLines={props.runtimeItemStartupFailure.outputLines} />
		</div>
	);
});
