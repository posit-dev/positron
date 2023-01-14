/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./console';
import * as React from 'react';
//import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// ConsoleProps interface.
interface ConsoleProps {
	message: string;
}

/**
 * Console component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const Console = (props: ConsoleProps) => {
	// Render.
	return (
		<div className='console' >
			<div>
				Console
			</div>
		</div>
	);
};
