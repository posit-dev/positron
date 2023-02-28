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
		<div className='output-lines'>
			{outputLines.map(outputLine =>
				<div key={outputLine.id} className='output-line'>
					{!outputLine.outputRuns.length ?
						<br /> :
						outputLine.outputRuns.map(outputRun => {
							let color;
							switch (outputRun.foreground) {
								case 'ansiBlack':
									color = 'black';
									break;

								case 'ansiRed':
									color = 'red';
									break;

								case 'ansiGreen':
									color = 'green';
									break;

								case 'ansiYellow':
									color = 'yellow';
									break;

								case 'ansiBlue':
									color = 'blue';
									break;

								case 'ansiMagenta':
									color = 'magenta';
									break;

								case 'ansiCyan':
									color = 'cyan';
									break;

								case 'ansiWhite':
									color = '#efefef';
									break;
							}

							return <span key={outputRun.id} style={{ color }}>{outputRun.text}</span>;
						})
					}
				</div>
			)}
		</div>
	);
};
