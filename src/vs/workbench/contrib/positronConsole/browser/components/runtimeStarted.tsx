/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStarted.css';

// React.
import React from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStarted } from '../../../../services/positronConsole/browser/classes/runtimeItemStarted.js';

// RuntimeStartedProps interface.
export interface RuntimeStartedProps {
	runtimeItemStarted: RuntimeItemStarted;
}

/**
 * RuntimeStarted component.
 * @param props A RuntimeStartedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStarted = (props: RuntimeStartedProps) => {
	// Render.
	return (
		<ConsoleOutputLines outputLines={props.runtimeItemStarted.outputLines} />
	);
};
