/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStarted';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarted';

// RuntimeStartedProps interface.
export interface RuntimeStartedProps {
	runtimeItemStarted: RuntimeItemStarted;
}

/**
 * RuntimeStarted component.
 * @param props A RuntimeStartedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStarted = (props: RuntimeStartedProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.runtimeItemStarted.outputLines} />
	);
};
