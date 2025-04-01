/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeTrace.css';

// React.
import React from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { RuntimeItemTrace } from '../../../../services/positronConsole/browser/classes/runtimeItemTrace.js';

// RuntimeTraceProps interface.
export interface RuntimeTraceProps {
	runtimeItemTrace: RuntimeItemTrace;
}

/**
 * Formats a timestamp.
 * @param timestamp The timestamp.
 * @returns The formatted timestamp.
 */
const formatTimestamp = (timestamp: Date) => {
	const toTwoDigits = (v: number) => v < 10 ? `0${v}` : v;
	const toFourDigits = (v: number) => v < 10 ? `000${v}` : v < 1000 ? `0${v}` : v;
	return `${toTwoDigits(timestamp.getHours())}:${toTwoDigits(timestamp.getMinutes())}:${toTwoDigits(timestamp.getSeconds())}.${toFourDigits(timestamp.getMilliseconds())}`;
};

/**
 * RuntimeTrace component.
 * @param props A RuntimeTraceProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeTrace = (props: RuntimeTraceProps) => {
	// Render.
	return (
		<div className='runtime-trace'>
			<div>
				{formatTimestamp(props.runtimeItemTrace.timestamp)}
			</div>
			<ConsoleOutputLines outputLines={props.runtimeItemTrace.outputLines} />
		</div>
	);
};
