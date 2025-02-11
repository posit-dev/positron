/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputLines.css';

// React.
import React from 'react';

// Other dependencies.
import { ANSIOutputLine } from '../../../base/common/ansiOutput.js';
import { OutputLine } from './outputLine.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';

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
					notificationService={props.notificationService}
					openerService={props.openerService}
					outputLine={outputLine}
				/>
			)}
		</>
	);
};
