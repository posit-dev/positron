/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityInput';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ActivityItemInput, ActivityItemInputState } from 'vs/workbench/services/positronConsole/browser/classes/activityItemInput';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { OutputRun } from 'vs/workbench/browser/positronAnsiRenderer/outputRun';

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
	// Hooks.
	const [state, setState] = useState(props.activityItemInput.state);

	// Get services from the context.
	const { openerService, notificationService } = usePositronConsoleContext();

	// Main useEffect.
	React.useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Listen for state changes to the item.
		disposableStore.add(props.activityItemInput.onStateChanged(() => {
			setState(props.activityItemInput.state);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.activityItemInput]);

	// Calculate the prompt length.
	const promptLength = Math.max(
		props.activityItemInput.inputPrompt.length,
		props.activityItemInput.continuationPrompt.length
	) + 1;

	// Calculate the prompt width.
	const promptWidth = Math.round(promptLength * props.fontInfo.typicalHalfwidthCharacterWidth);

	// Generate the class names.
	const classNames = positronClassNames(
		'activity-input',
		{ 'executing': state === ActivityItemInputState.Executing },
		{ 'cancelled': state === ActivityItemInputState.Cancelled }
	);

	// Render.
	return (
		<div className={classNames}>
			{state === ActivityItemInputState.Executing && <div className='progress-bar' />}
			{props.activityItemInput.codeOutputLines.map((outputLine, index) =>
				<div key={outputLine.id}>
					<span className='prompt' style={{ width: promptWidth }}>
						{(index === 0 ?
							props.activityItemInput.inputPrompt :
							props.activityItemInput.continuationPrompt) + ' '
						}
					</span>
					{outputLine.outputRuns.map(outputRun =>
						<OutputRun
							key={outputRun.id}
							outputRun={outputRun}
							notificationService={notificationService}
							openerService={openerService}
						/>
					)}
				</div>
			)}
		</div>
	);
};
