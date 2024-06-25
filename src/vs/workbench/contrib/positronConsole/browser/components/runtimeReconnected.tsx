/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeReconnected';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemReconnected';

// RuntimeReconnectedProps interface.
export interface RuntimeReconnectedProps {
	runtimeItemReconnected: RuntimeItemReconnected;
}

/**
 * RuntimeReconnected component.
 * @param props A RuntimeReconnectedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeReconnected = (props: RuntimeReconnectedProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.runtimeItemReconnected.outputLines} />
	);
};
