/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityErrorStream.css';

// React.
import React from 'react';

// Other dependencies.
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
