/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLines';
import * as React from 'react';
import { ANSIOutputLine } from 'vs/base/common/ansi-output';
import { OutputLine } from 'vs/workbench/contrib/positronConsole/browser/components/outputLine';

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
