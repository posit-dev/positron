/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityError';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';

// ActivityErrorProps interface.
export interface ActivityErrorProps {
	activityItemError: ActivityItemError;
}

/**
 * ActivityError component.
 * @param props An ActivityErrorProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityError = ({ activityItemError }: ActivityErrorProps) => {
	// Render.
	return (
		<div className='activity-error'>
			<OutputLines outputLines={activityItemError.messageOutputLines} />
			{activityItemError.tracebackOutputLines.length > 0 &&
				<div className='traceback-lines'>
					<OutputLines outputLines={activityItemError.tracebackOutputLines} />
				</div>
			}
		</div>
	);
};
