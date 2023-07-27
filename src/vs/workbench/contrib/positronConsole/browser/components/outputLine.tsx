/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLine';
import * as React from 'react';
import { ANSIOutputLine } from 'ansi-output';
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';

// OutputLineProps interface.
export interface OutputLineProps {
	readonly outputLine: ANSIOutputLine;
}

/**
 * OutputLine component.
 * @param props A OutputLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLine = (props: OutputLineProps) => {
	// Render.
	return (
		<div>
			{!props.outputLine.outputRuns.length ?
				<br /> :
				props.outputLine.outputRuns.map(outputRun =>
					<OutputRun key={outputRun.id} outputRun={outputRun} />
				)
			}
		</div>
	);
};
