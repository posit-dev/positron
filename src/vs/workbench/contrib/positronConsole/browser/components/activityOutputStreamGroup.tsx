/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputStreamGroup';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStreamGroup';

// ActivityOutputStreamGroupProps interface.
export interface ActivityOutputStreamGroupProps {
	activityItemOutputStreamGroup: ActivityItemOutputStreamGroup;
}

/**
 * ActivityOutputStreamGroup component.
 * @param props An ActivityOutputStreamGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputStreamGroup = (props: ActivityOutputStreamGroupProps) => {
	// Render.
	return (
		<div className='activity-output-stream-group'>
			<OutputLines outputLines={props.activityItemOutputStreamGroup.outputLines} />
		</div>
	);
};
