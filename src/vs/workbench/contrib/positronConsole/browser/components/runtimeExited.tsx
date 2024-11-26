/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './runtimeExited.css';
import * as React from 'react';
import { OutputLines } from './outputLines.js';
import { RuntimeItemExited } from '../../../../services/positronConsole/browser/classes/runtimeItemExited.js';

// RuntimeExitedProps interface.
export interface RuntimeExitedProps {
	runtimeItemExited: RuntimeItemExited;
}

/**
 * RuntimeExited component.
 * @param props A RuntimeExitedProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeExited = (props: RuntimeExitedProps) => {

	// Render.
	return (
		<div className='runtime-exited'>
			<OutputLines outputLines={props.runtimeItemExited.outputLines} />
		</div>
	);
};
