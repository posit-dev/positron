/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeExited.css';

// React.
import React from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemExited } from '../../../../services/positronConsole/browser/classes/runtimeItemExited.js';

// RuntimeExitedProps interface.
export interface RuntimeExitedProps {
	runtimeItemExited: RuntimeItemExited;
}

/**
 * RuntimeExited component.
 * @param props A RuntimeExitedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeExited = (props: RuntimeExitedProps) => {
	// Render.
	return (
		<div className='runtime-exited'>
			<ConsoleOutputLines outputLines={props.runtimeItemExited.outputLines} />
		</div>
	);
};
