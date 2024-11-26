/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './outputLine.css';
import * as React from 'react';
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
						outputRun={outputRun}
						openerService={props.openerService}
						notificationService={props.notificationService}
					/>
				)
			}
		</div>
	);
};
