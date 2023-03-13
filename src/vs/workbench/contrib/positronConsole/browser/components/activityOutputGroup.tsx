/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutput';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputGroup';

// ActivityOutputGroupProps interface.
export interface ActivityOutputGroupProps {
	activityItemOutputGroup: ActivityItemOutputGroup;
}

/**
 * ActivityOutputGroup component.
 * @param props An ActivityOutputGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputGroup = (props: ActivityOutputGroupProps) => {
	// Render.
	return (
		<div className='activity-output-group'>
			<OutputLines outputLines={props.activityItemOutputGroup.outputLines} />
		</div>
	);
};
