/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStarting.css';

// React.
import React from 'react';

// Other dependencies.
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
		<div className='console-item-starting runtime-starting'>
			<div className='left-bar'></div>
			<div className='starting-message'>
				<OutputLines outputLines={props.runtimeItemStarting.outputLines} />
			</div>
		</div>
	);
};
