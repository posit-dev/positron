/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputLine.css';

// Other dependencies.
import { OutputRun } from './outputRun.js';
import { ANSIOutputLine } from '../../../base/common/ansiOutput.js';

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
	// If there are no output runs, render a line break for an empty line.
	if (!props.outputLine.outputRuns.length) {
		return <br />;
	}

	// Render.
	return (
		<div>
			{props.outputLine.outputRuns.map(outputRun =>
				<OutputRun key={outputRun.id} outputRun={outputRun} />
			)}
		</div>
	);
};
