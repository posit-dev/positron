/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityErrorStream';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/browser/classes/activityItemStream';

// ActivityErrorStreamProps interface.
export interface ActivityErrorStreamProps {
	activityItemErrorStream: ActivityItemErrorStream;
}

/**
 * ActivityErrorStream component.
 * @param props An ActivityErrorStreamProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityErrorStream = (props: ActivityErrorStreamProps) => {
	// Render.
	return (
		<div className='activity-error-stream'>
			<OutputLines outputLines={props.activityItemErrorStream.outputLines} />
		</div>
	);
};
