/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputLine.css';

// React.
import React from 'react';

// Other dependencies.
import { ANSIOutputLine } from '../../../base/common/ansiOutput.js';
import { OutputRun } from './outputRun.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';

// OutputLineProps interface.
export interface OutputLineProps {
	readonly outputLine: ANSIOutputLine;
	readonly openerService: IOpenerService;
	readonly notificationService: INotificationService;
}

/**
 * OutputLine component.
 * @param props A OutputLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLine = (props: OutputLineProps) => {

	// Render.
	return (
		<div>
			{!props.outputLine.outputRuns.length ?
				<br /> :
				props.outputLine.outputRuns.map(outputRun =>
					<OutputRun
						key={outputRun.id}
						notificationService={props.notificationService}
						openerService={props.openerService}
						outputRun={outputRun}
					/>
				)
			}
		</div>
	);
};
