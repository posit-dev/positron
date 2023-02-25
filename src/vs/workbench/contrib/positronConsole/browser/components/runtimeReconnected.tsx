/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeReconnected';
import * as React from 'react';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';

// RuntimeReconnectedProps interface.
export interface RuntimeReconnectedProps {
	runtimeItemReconnected: RuntimeItemReconnected;
}

/**
 * RuntimeReconnected component.
 * @param props A RuntimeReconnectedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeReconnected = ({ runtimeItemReconnected }: RuntimeReconnectedProps) => {
	// Render.
	return (
		<div className='runtime-reconnected'>
			<OutputLines outputLines={runtimeItemReconnected.outputLines} />
		</div>
	);
};
