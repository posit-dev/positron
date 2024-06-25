/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLine';
import * as React from 'react';
import { ANSIOutputLine } from 'vs/base/common/ansiOutput';
import { OutputRun } from 'vs/workbench/browser/positronAnsiRenderer/outputRun';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { INotificationService } from 'vs/platform/notification/common/notification';

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
