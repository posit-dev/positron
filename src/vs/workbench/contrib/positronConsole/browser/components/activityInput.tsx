/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityInput';
import * as React from 'react';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';
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
		(props.activityItemInput.inputPrompt.length + 1) * props.fontInfo.typicalHalfwidthCharacterWidth
	);

	// Render.
	return (
		<>
			{props.activityItemInput.codeOutputLines.map((outputLine, index) =>
				<div key={outputLine.id}>
					<span style={{ width: promptWidth }}>
						{index === 0 ?
							props.activityItemInput.inputPrompt :
							props.activityItemInput.continuationPrompt
						}
					</span>
					<span>&nbsp;</span>
					{outputLine.outputRuns.map(outputRun =>
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)}
				</div>
			)}
		</>
	);
};
