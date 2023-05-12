/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityInput';
import * as React from 'react';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';

// ActivityInputProps interface.
export interface ActivityInputProps {
	fontInfo: FontInfo;
	activityItemInput: ActivityItemInput;
}

/**
 * ActivityInput component.
 * @param props An ActivityInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityInput = (props: ActivityInputProps) => {
	// Calculate the prompt width.
	const promptWidth = Math.ceil(
		(props.activityItemInput.prompt.length + 1) * props.fontInfo.typicalHalfwidthCharacterWidth
	);

	// Slice the output lines.
	const outputLines = props.activityItemInput.codeOutputLines.slice(1);

	// Render.
	return (
		<>
			<div>
				<span style={{ width: promptWidth }}>{props.activityItemInput.prompt}</span>
				<span>&nbsp;</span>
				{props.activityItemInput.codeOutputLines.length > 0 &&
					props.activityItemInput.codeOutputLines[0].outputRuns.map(outputRun =>
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)
				}
			</div>
			{outputLines.length > 0 &&
				<div style={{ marginLeft: promptWidth }}>
					<OutputLines outputLines={outputLines} />
				</div>
			}
		</>
	);
};
