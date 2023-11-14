/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeOffline';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemOffline';

// RuntimeExitedProps interface.
export interface RuntimeOfflineProps {
	runtimeItemOffline: RuntimeItemOffline;
}

/**
 * RuntimeOffline component.
 * @param props A RuntimeOfflineProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeOffline = (props: RuntimeOfflineProps) => {
	// Render.
	return (
		<div className='runtime-offline'>
			<OutputLines outputLines={props.runtimeItemOffline.outputLines} />
		</div>
	);
};
