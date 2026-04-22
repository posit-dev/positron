/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStarting.css';

// React.
import { memo } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStarting } from '../../../../services/positronConsole/browser/classes/runtimeItemStarting.js';

// RuntimeStartingProps interface.
export interface RuntimeStartingProps {
	runtimeItemStarting: RuntimeItemStarting;
}

// RuntimeItemStarting is effectively write-once after construction (attachMode
// is declared public but is never mutated), so memo with the default shallow
// compare on runtimeItemStarting lets us skip re-renders whenever the parent
// list re-renders (e.g. on every stream chunk).
export const RuntimeStarting = memo((props: RuntimeStartingProps) => {
	return (
		<div className='console-item-starting runtime-starting'>
			<div className='left-bar' />
			<div className='starting-message'>
				<ConsoleOutputLines outputLines={props.runtimeItemStarting.outputLines} />
			</div>
		</div>
	);
});
