/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeReconnected.css';

// React.
import React from 'react';

// Other dependencies.
import { OutputLines } from './outputLines.js';
import { RuntimeItemReconnected } from '../../../../services/positronConsole/browser/classes/runtimeItemReconnected.js';

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
