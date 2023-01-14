/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';
//import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// ConsoleReplProps interface.
interface ConsoleReplProps {
	consoleReplInstance: ConsoleReplInstance;
}

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = (props: ConsoleReplProps) => {
	// Render.
	return (
		<div className='console-repl' >
			<div>
				Console for {props.consoleReplInstance.displayName}
			</div>
		</div>
	);
};
