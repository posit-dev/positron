/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStartup';
import * as React from 'react';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';

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
			<OutputLines outputLines={runtimeItemStartup.outputLines} />
		</div>
	);
};
