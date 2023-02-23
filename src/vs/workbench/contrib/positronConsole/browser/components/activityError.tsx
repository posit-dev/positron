/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityError';
import * as React from 'react';
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
			<div className='message-lines'>
				{activityItemError.messageLines.map(messageLine =>
					<div key={messageLine.id} className='message-line'>
						{messageLine.text.length ? <div>{messageLine.text}</div> : <br />}
					</div>
				)}
			</div>
			{activityItemError.tracebackLines.length > 0 &&
				<div className='traceback-lines'>
					{activityItemError.tracebackLines.map(tracebackLine =>
						<div key={tracebackLine.id} className='traveback-line'>
							{tracebackLine.text.length ? <div>{tracebackLine.text}</div> : <br />}
						</div>
					)}
				</div>
			}
		</div>
	);
};
