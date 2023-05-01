/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityPrompt';
import * as React from 'react';
// import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemPrompt } from 'vs/workbench/services/positronConsole/common/classes/activityItemPrompt';

// ActivityPromptProps interface.
export interface ActivityPromptProps {
	activityItemPrompt: ActivityItemPrompt;
}

/**
 * ActivityPrompt component.
 * @param props An ActivityPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityPrompt = (props: ActivityPromptProps) => {
	// Render.
	return (
		<div className='activity-prompt'>
			<div className='prompt'>{props.activityItemPrompt.prompt + ' '}</div>
			{/* <OutputLines outputLines={props.activityItemInput.codeOutputLines} /> */}
		</div>
	);
};
