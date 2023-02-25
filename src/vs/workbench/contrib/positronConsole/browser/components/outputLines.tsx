/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./outputLines';
import * as React from 'react';
import { OutputLine } from 'vs/workbench/services/positronConsole/common/classes/outputLine';

// OutputLinesProps interface.
export interface OutputLinesProps {
	readonly outputLines: readonly OutputLine[];
}

/**
 * OutputLines component.
 * @param props A OutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLines = ({ outputLines }: OutputLinesProps) => {
	// Render.
	return (
		<div>
			{outputLines.map(outputLine =>
				<div key={outputLine.id} className='output-line'>
					{!outputLine.text.length ? <br /> : <div>{outputLine.text}</div>}
				</div>
			)}
		</div>
	);
};
