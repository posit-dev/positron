/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityErrorStream';
import * as React from 'react';
import { OutputLines } from './outputLines.js';
import { ActivityItemErrorStream } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';

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
