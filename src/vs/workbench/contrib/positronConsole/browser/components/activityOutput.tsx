/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { lineSplitter } from 'vs/workbench/services/positronConsole/common/classes/utils';
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
	const lines = useMemo(() => {
		if (activityItemOutput.data['text/plain'].length === 0) {
			return [];
		} else {
			return lineSplitter(activityItemOutput.data['text/plain']);
		}
	}, [activityItemOutput]);

	// Render.
	return (
		<div className='activity-output'>
			<div className='output-lines'>
				{lines.map(line =>
					<div key={line.id} className='output-line'>
						{line.text.length ? <div>{line.text}</div> : <br />}
					</div>
				)}
			</div>
		</div>
	);
};
