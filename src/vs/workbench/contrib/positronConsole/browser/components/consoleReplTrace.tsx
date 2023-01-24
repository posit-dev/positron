/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplTrace';
import * as React from 'react';

// ConsoleReplTraceProps interface.
export interface ConsoleReplTraceProps {
	timestamp: Date;
	message: string;
}

/**
 * ConsoleReplTrace component.
 * @param props A ConsoleReplTraceProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplTrace = ({ timestamp, message }: ConsoleReplTraceProps) => {
	// Render.
	return (
		<div className='console-repl-trace'>
			[{timestamp.toLocaleTimeString()}] {message}
		</div>
	);
};
