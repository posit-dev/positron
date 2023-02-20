/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replActivityRunOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { lineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ActivityItemOutput } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItemOutput';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';

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
