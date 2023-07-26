/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityInput';
import * as React from 'react';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { DisposableStore } from 'vs/base/common/lifecycle';

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
		(props.activityItemInput.inputPrompt.length + 1) *
		props.fontInfo.typicalHalfwidthCharacterWidth
	);

	const activityRef = React.useRef<HTMLDivElement>(undefined!);

	React.useEffect(() => {
		const disposables = new DisposableStore();
		// Listen for the busy state to change on the activity item; when it
		// does, update the `busy` class on the activity input.
		disposables.add(props.activityItemInput.onBusyStateChanged((busy: boolean) => {
			console.log(props.activityItemInput.id + ' busy: ' + busy);
			console.log(activityRef.current);
			if (busy) {
				activityRef.current?.classList.add('busy');
			} else {
				activityRef.current?.classList.remove('busy');
			}
		}));
		return () => disposables.dispose();
	}, [props.activityItemInput]);

	// Render.
	return (
		<div ref={activityRef}
			className={
				'activity-input' +
				(props.activityItemInput.busyState ?
					' busy' : '')}>
			<div className='progress-bar'></div>
			{props.activityItemInput.codeOutputLines.map((outputLine, index) =>
				<div key={outputLine.id}>
					<span style={{ width: promptWidth }}>
						{(index === 0 ?
							props.activityItemInput.inputPrompt :
							props.activityItemInput.continuationPrompt) + ' '
						}
					</span>
					{outputLine.outputRuns.map(outputRun =>
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)}
				</div>
			)}
		</div>
	);
};
