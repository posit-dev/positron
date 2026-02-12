/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './outputLines.css';

// Other dependencies.
import { OutputLine } from './outputLine.js';
import { ANSIOutputLine } from '../../../base/common/ansiOutput.js';

// OutputLinesProps interface.
export interface OutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * OutputLines component.
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLines = (props: OutputLinesProps) => {
	// Render.
	return (
		<>
			{props.outputLines.map(outputLine =>
				<OutputLine key={outputLine.id} outputLine={outputLine} />
			)}
		</>
	);
};
