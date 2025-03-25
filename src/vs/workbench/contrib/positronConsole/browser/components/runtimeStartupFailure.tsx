/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStartupFailure.css';

// React.
import React from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStartupFailure } from '../../../../services/positronConsole/browser/classes/runtimeItemStartupFailure.js';

// RuntimeStartupFailureProps interface.
export interface RuntimeStartupFailureProps {
	runtimeItemStartupFailure: RuntimeItemStartupFailure;
}

/**
 * RuntimeStartupFailure component.
 * @param props A RuntimeStartupFailureProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartupFailure = (props: RuntimeStartupFailureProps) => {
	// Render.
	return (
		<div className='runtime-startup-failure'>
			<div className='message'>{props.runtimeItemStartupFailure.message}</div>
			<ConsoleOutputLines outputLines={props.runtimeItemStartupFailure.outputLines} />
		</div>
	);
};
