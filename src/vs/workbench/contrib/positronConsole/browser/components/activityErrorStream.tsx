/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityErrorStream.css';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { ActivityItemStream } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';

// ActivityErrorStreamProps interface.
export interface ActivityErrorStreamProps {
	activityItemStream: ActivityItemStream;
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
			<ConsoleOutputLines outputLines={props.activityItemStream.outputLines} />
		</div>
	);
};
