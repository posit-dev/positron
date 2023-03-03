/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { ANSIOutput } from 'vs/base/common/ansi/ansiOutput';
import { ANSIOutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/ansiOutputLines';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';

// ActivityOutputProps interface.
export interface ActivityOutputProps {
	activityItemOutput: ActivityItemOutput;
}

/**
 * ActivityOutput component.
 * @param props An ActivityOutputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutput = ({ activityItemOutput }: ActivityOutputProps) => {
	// Hooks.
	const outputLines = useMemo(() => {
		if (activityItemOutput.data['text/plain'].length === 0) {
			return [];
		} else {
			return ANSIOutput.processOutput(activityItemOutput.data['text/plain']);
		}
	}, [activityItemOutput]);

	// Render.
	return (
		<div className='activity-output'>
			<ANSIOutputLines outputLines={outputLines} />
		</div>
	);
};
