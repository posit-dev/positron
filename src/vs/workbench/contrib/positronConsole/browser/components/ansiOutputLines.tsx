/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./ansiOutputLines';
import * as React from 'react';
import { ANSIColor, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

// ANSIOutputLinesProps interface.
export interface ANSIOutputLinesProps {
	readonly outputLines: readonly ANSIOutputLine[];
}

/**
 * ANSIOutputLines component.
 * @param props A ANSIOutputLinesProps that contains the component properties.
 * @returns The rendered component.
 */
export const ANSIOutputLines = ({ outputLines }: ANSIOutputLinesProps) => {
	// Render.
	return (
		<div className='ansi-output-lines'>
			{outputLines.map(outputLine =>
				<div key={outputLine.id} className='output-line'>
					{!outputLine.outputRuns.length ?
						<br /> :
						outputLine.outputRuns.map(outputRun => {
							let color;
							switch (outputRun.foregroundColor) {
								case ANSIColor.Black:
									color = 'black';
									break;

								case ANSIColor.Red:
									color = 'red';
									break;

								case ANSIColor.Green:
									color = 'green';
									break;

								case ANSIColor.Yellow:
									color = 'yellow';
									break;

								case ANSIColor.Blue:
									color = 'blue';
									break;

								case ANSIColor.Magenta:
									color = 'magenta';
									break;

								case ANSIColor.Cyan:
									color = 'cyan';
									break;

								case ANSIColor.White:
									color = 'white';
									break;

								case ANSIColor.BrightBlack:
									color = 'black';
									break;

								case ANSIColor.BrightRed:
									color = 'red';
									break;

								case ANSIColor.BrightGreen:
									color = 'green';
									break;

								case ANSIColor.BrightYellow:
									color = 'yellow';
									break;

								case ANSIColor.BrightBlue:
									color = 'blue';
									break;

								case ANSIColor.BrightMagenta:
									color = 'magenta';
									break;

								case ANSIColor.BrightCyan:
									color = 'cyan';
									break;

								case ANSIColor.BrightWhite:
									color = 'white';
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
