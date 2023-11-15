/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStartupFailure';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartupFailure';

// RuntimeStartupFailureProps interface.
export interface RuntimeStartupFailureProps {
	runtimeItemStartupFailure: RuntimeItemStartupFailure;
}

/**
 * RuntimeStartupFailure component.
 * @param props A RuntimeStartupFailureProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartupFailure = (props: RuntimeStartupFailureProps) => {
	// Render.
	return (
		<div className='runtime-startup-failure'>
			<div className='message'>{props.runtimeItemStartupFailure.message}</div>
			<OutputLines outputLines={props.runtimeItemStartupFailure.outputLines} />
		</div>
	);
};
