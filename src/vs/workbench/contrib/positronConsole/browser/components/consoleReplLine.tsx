/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplLine';
import * as React from 'react';

// ConsoleReplLineProps interface.
export interface ConsoleReplLineProps {
	key: string;
	text: string;
}

/**
 * ConsoleReplLine component.
 * @param props A ConsoleReplLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplLine = ({ key, text }: ConsoleReplLineProps) => {
	// Render.
	return (
		<div key={key} className='console-repl-line'>
			{!text.length ? <br /> : <div>{text}</div>}
		</div>
	);
};
