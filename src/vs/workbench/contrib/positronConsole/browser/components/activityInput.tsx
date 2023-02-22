/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityInput';
import * as React from 'react';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';

// ActivityInputProps interface.
export interface ActivityInputProps {
	activityItemInput: ActivityItemInput;
}

/**
 * ActivityInput component.
 * @param props An ActivityInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityInput = ({ activityItemInput }: ActivityInputProps) => {
	// Render.
	return (
		<div className='activity-input'>
			<div className='prompt'>&gt;</div>
			<ReplLines {...activityItemInput} />
		</div>
	);
};
