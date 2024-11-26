/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './runtimeStarting.css';
import * as React from 'react';
import { OutputLines } from './outputLines.js';
import { RuntimeItemStarting } from '../../../../services/positronConsole/browser/classes/runtimeItemStarting.js';

// RuntimeStartingProps interface.
export interface RuntimeStartingProps {
	runtimeItemStarting: RuntimeItemStarting;
}

/**
 * RuntimeStarting component.
 * @param props A RuntimeStartingProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStarting = (props: RuntimeStartingProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.runtimeItemStarting.outputLines} />
	);
};
