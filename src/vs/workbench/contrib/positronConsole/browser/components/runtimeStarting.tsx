/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStarting';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarting';

// RuntimeStartingProps interface.
export interface RuntimeStartingProps {
	runtimeItemStarting: RuntimeItemStarting;
}

/**
 * RuntimeStarting component.
 * @param props A RuntimeStartingProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStarting = ({ runtimeItemStarting }: RuntimeStartingProps) => {
	// Render.
	return (
		<div className='runtime-starting'>
			<OutputLines outputLines={runtimeItemStarting.outputLines} />
		</div>
	);
};
