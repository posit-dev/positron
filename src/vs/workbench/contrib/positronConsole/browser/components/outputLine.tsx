/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLine';
import * as React from 'react';
import { ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
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
export const OutputLine = ({ outputLine }: OutputLineProps) => {
	// Render.
	return (
		<div className='output-line'>
			{!outputLine.outputRuns.length ?
				<br /> :
				outputLine.outputRuns.map(outputRun =>
					<OutputRun key={outputRun.id} outputRun={outputRun} />
				)
			}
		</div>
	);
};
