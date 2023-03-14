/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputMessage';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';

// ActivityOutputMessageProps interface.
export interface ActivityOutputMessageProps {
	activityItemOutputMessage: ActivityItemOutputMessage;
}

/**
 * ActivityOutputMessage component.
 * @param props An ActivityOutputMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputMessage = (props: ActivityOutputMessageProps) => {
	// Render.
	return (
		<div className='activity-output-message'>
			<OutputLines outputLines={props.activityItemOutputMessage.outputLines} />
		</div>
	);
};
