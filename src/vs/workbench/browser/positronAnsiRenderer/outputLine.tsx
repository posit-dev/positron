/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputLine.css';

// React.
import React from 'react';

// Other dependencies.
import { OutputRun } from './outputRun.js';
import { ANSIOutputLine } from '../../../base/common/ansiOutput.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IWorkbenchEnvironmentService } from '../../services/environment/common/environmentService.js';
import { IPathService } from '../../services/path/common/pathService.js';

// OutputLineProps interface.
export interface OutputLineProps {
	readonly openerService: IOpenerService;
	readonly notificationService: INotificationService;
	readonly pathService: IPathService;
	readonly environmentService: IWorkbenchEnvironmentService;
	readonly outputLine: ANSIOutputLine;
}

/**
 * OutputLine component.
 * @param props A OutputLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLine = (props: OutputLineProps) => {
	// If there are no output runs, render a line break for an empty line.
	if (!props.outputLine.outputRuns.length) {
		return <br />;
	}

	// Render.
	return (
		<div>
			{props.outputLine.outputRuns.map(outputRun =>
				<OutputRun
					key={outputRun.id}
					environmentService={props.environmentService}
					notificationService={props.notificationService}
					openerService={props.openerService}
					outputRun={outputRun}
					pathService={props.pathService}
				/>
			)}
		</div>
	);
};
