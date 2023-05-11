/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityPrompt';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
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
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Main useEffect hook.
	useEffect(() => {
		// Make sure the input is scrolled into view.
		inputRef.current?.scrollIntoView({ behavior: 'auto' });
		inputRef.current.focus();
	}, [inputRef]);

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		/**
		 * Consumes an event.
		 */
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Process the key.
		switch (e.code) {
			// Enter key.
			case 'Enter': {
				// Consume the event.
				consumeEvent();

				// Upate the prompt state and reply to it.
				const value = inputRef.current?.value;
				props.activityItemPrompt.state = ActivityItemPromptState.Answered;
				props.activityItemPrompt.answer = !props.activityItemPrompt.password ? value : '';
				props.positronConsoleInstance.replyToPrompt(props.activityItemPrompt.id, value);
				break;
			}

			// C key.
			case 'KeyC': {
				// Handle Ctrl+C.
				if (e.ctrlKey) {
					// Consume the event.
					consumeEvent();

					// Upate the prompt state and interrupt it.
					props.activityItemPrompt.state = ActivityItemPromptState.Interrupted;
					props.positronConsoleInstance.interruptPrompt(props.activityItemPrompt.id);
				}
				break;
			}
		}
	};

	// Set the prompt for the rendering.
	let prompt;
	switch (props.activityItemPrompt.state) {
		// When the prompt is unanswered, render the input.
		case ActivityItemPromptState.Unanswered:
			prompt = (
				<input
					ref={inputRef}
					className='input-field'
					type={props.activityItemPrompt.password ? 'password' : 'text'}
					onKeyDown={keyDownHandler}
				/>
			);
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
		<div className='activity-prompt'>
			<OutputLines outputLines={props.activityItemPrompt.outputLines.slice(0, -1)} />
			<div className='prompt-line'>
				{props.activityItemPrompt.outputLines.slice(-1).map(outputLine =>
					outputLine.outputRuns.map(outputRun =>
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)
				)}
				{prompt}
			</div>
		</div>
	);
};
