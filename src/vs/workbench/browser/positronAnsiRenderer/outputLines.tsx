/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLines';
import * as React from 'react';
import { ANSIOutputLine } from 'vs/base/common/ansiOutput';
import { OutputLine } from 'vs/workbench/browser/positronAnsiRenderer/outputLine';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { INotificationService } from 'vs/platform/notification/common/notification';

// OutputLinesProps interface.
export interface OutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
	readonly openerService: IOpenerService;
	readonly notificationService: INotificationService;
}

/**
 * OutputLines component.
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLines = (props: OutputLinesProps) => {
	// Render.
	return (
		<>
			{props.outputLines.map(outputLine =>
				<OutputLine
					key={outputLine.id}
					outputLine={outputLine}
					openerService={props.openerService}
					notificationService={props.notificationService}
				/>
			)}
		</>
	);
};
