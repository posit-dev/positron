/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeStartupProgress.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IRuntimeAutoStartEvent } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';

// RuntimeStartupProgressProps interface.
export interface RuntimeStartupProgressProps {
	evt: IRuntimeAutoStartEvent;
}

const preparing = localize('positron.runtimeStartup.newSession', "Preparing");
const reconnecting = localize('positron.runtimeStartup.existingSession', "Reconnecting");
/**
 * RuntimeStartupProgress component.
 * @param props A RuntimeStartupProgressProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeStartupProgress = (props: RuntimeStartupProgressProps) => {
	// Render.
	return (
		<div className='runtime-starting'>
			<img className='runtime-starting-icon' src={`data:image/svg+xml;base64,${props.evt.runtime.base64EncodedIconSvg}`} />
			<div className='action'>{props.evt.newSession ? preparing : reconnecting}</div>
			<div className='runtime-name'>{props.evt.runtime.runtimeName}</div>
		</div>
	);
};

