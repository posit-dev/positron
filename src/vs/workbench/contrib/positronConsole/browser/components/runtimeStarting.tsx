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

/**
 * RuntimeStarting component.
 * @param props A RuntimeStartingProps that contains the component properties.
 * @returns The memoized component.
 */
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
