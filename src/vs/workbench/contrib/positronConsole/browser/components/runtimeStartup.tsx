/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStartup.css';

// React.
import React from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemStartup } from '../../../../services/positronConsole/browser/classes/runtimeItemStartup.js';

// RuntimeStartupProps interface.
export interface RuntimeStartupProps {
	runtimeItemStartup: RuntimeItemStartup;
}

/**
 * RuntimeStartup component.
 * @param props A RuntimeStartupProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartup = (props: RuntimeStartupProps) => {
	// Render.
	return (
		<ConsoleOutputLines outputLines={props.runtimeItemStartup.outputLines} />
	);
};
