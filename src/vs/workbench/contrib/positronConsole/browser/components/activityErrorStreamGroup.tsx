/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityErrorStreamGroup';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemErrorStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStreamGroup';

// ActivityErrorStreamGroupProps interface.
export interface ActivityErrorStreamGroupProps {
	activityItemErrorStreamGroup: ActivityItemErrorStreamGroup;
}

/**
 * ActivityErrorStreamGroup component.
 * @param props An ActivityErrorStreamGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityErrorStreamGroup = (props: ActivityErrorStreamGroupProps) => {
	// Render.
	return (
		<div className='activity-error-stream-group'>
			<OutputLines outputLines={props.activityItemErrorStreamGroup.outputLines} />
		</div>
	);
};
