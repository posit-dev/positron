/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStartup';
import * as React from 'react';
import { ANSIOutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/ansiOutputLines';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';

// RuntimeStartupProps interface.
export interface RuntimeStartupProps {
	runtimeItemStartup: RuntimeItemStartup;
}

/**
 * RuntimeStartup component.
 * @param props A RuntimeStartupProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartup = ({ runtimeItemStartup }: RuntimeStartupProps) => {
	// Render.
	return (
		<div className='runtime-startup'>
			<ANSIOutputLines outputLines={runtimeItemStartup.outputLines} />
		</div>
	);
};
