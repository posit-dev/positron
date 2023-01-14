/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
//import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// ConsoleReplProps interface.
interface ConsoleReplProps { }

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = (props: ConsoleReplProps) => {
	// Render.
	return (
		<div className='console' >
			<div>
				Console
			</div>
		</div>
	);
};
