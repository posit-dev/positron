/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStartup';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartup';

// RuntimeStartupProps interface.
export interface RuntimeStartupProps {
	runtimeItemStartup: RuntimeItemStartup;
}

/**
 * RuntimeStartup component.
 * @param props A RuntimeStartupProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartup = (props: RuntimeStartupProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.runtimeItemStartup.outputLines} />
	);
};
