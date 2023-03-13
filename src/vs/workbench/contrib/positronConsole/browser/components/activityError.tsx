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
export const ActivityError = (props: ActivityErrorProps) => {
	// Render.
	return (
		<div className='activity-error'>
			<OutputLines outputLines={props.activityItemError.messageOutputLines} />
			{props.activityItemError.tracebackOutputLines.length > 0 &&
				<div className='traceback-lines'>
					<OutputLines outputLines={props.activityItemError.tracebackOutputLines} />
				</div>
			}
		</div>
	);
};
