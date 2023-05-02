/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityPrompt';
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { ActivityItemPrompt, ActivityItemPromptState } from 'vs/workbench/services/positronConsole/common/classes/activityItemPrompt';

// ActivityPromptProps interface.
export interface ActivityPromptProps {
	activityItemPrompt: ActivityItemPrompt;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ActivityPrompt component.
 * @param props An ActivityPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityPrompt = (props: ActivityPromptProps) => {
	// Reference hooks.
	const inputRef = useRef<HTMLDivElement>(undefined!);

	// Main useEffect hook.
	useEffect(() => {
		// Make sure the input is scrolled into view.
		inputRef.current?.scrollIntoView({ behavior: 'auto' });
	}, [inputRef]);

	// onClick handler (placeholder).
	const clickHandler = () => {
		const answer = 'Some Value';
		props.activityItemPrompt.state = ActivityItemPromptState.Answered;
		props.activityItemPrompt.answer = !props.activityItemPrompt.password ? answer : '';
		props.positronConsoleInstance.replyToPrompt(props.activityItemPrompt.id, answer);
	};

	// Set the prompt.
	let prompt;
	switch (props.activityItemPrompt.state) {
		// When the prompt is unanswered, render the input.
		case ActivityItemPromptState.Unanswered:
			prompt = <span ref={inputRef} onClick={clickHandler}>[User Input Here]</span>;
			break;

		// When the prompt was answered, render the answer.
		case ActivityItemPromptState.Answered:
			prompt = props.activityItemPrompt.password ?
				null :
				<span>{props.activityItemPrompt.answer}</span>;
			break;

		// When the prompt was interrupted, render nothing.
		case ActivityItemPromptState.Interrupted:
			prompt = null;
			break;
	}

	// Render.
	return (
		<>
			<OutputLines outputLines={props.activityItemPrompt.outputLines.slice(0, -1)} />
			{props.activityItemPrompt.outputLines.slice(-1).map(outputLine =>
				outputLine.outputRuns.map(outputRun =>
					<OutputRun key={outputRun.id} outputRun={outputRun} />
				)
			)}
			{prompt}
		</>
	);
};
