/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replActivityRunOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { lineSplitter } from 'vs/workbench/services/positronConsole/common/classes/utils';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';

// ReplActivityRunOutputProps interface.
export interface ReplActivityRunOutputProps {
	replItemActivityRunOutput: ActivityItemOutput;
}

/**
 * ReplActivityRunOutput component.
 * @param props A ConsoleReplOutputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplActivityRunOutput = ({ replItemActivityRunOutput }: ReplActivityRunOutputProps) => {
	// Hooks.
	const lines = useMemo(() => {
		if (replItemActivityRunOutput.data['text/plain'].length === 0) {
			return [];
		} else {
			return lineSplitter(replItemActivityRunOutput.data['text/plain']);
		}
	}, [replItemActivityRunOutput]);


	// Render.
	return (
		<div className='repl-activity-run-output'>
			<ReplLines lines={lines} />
		</div>
	);
};
