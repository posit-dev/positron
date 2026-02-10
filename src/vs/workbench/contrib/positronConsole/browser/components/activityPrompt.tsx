/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityPrompt.css';

// React.
import { KeyboardEvent, useEffect, useRef } from 'react';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ActivityItemPrompt, ActivityItemPromptState } from '../../../../services/positronConsole/browser/classes/activityItemPrompt.js';

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
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	/**
	 * Readies the input.
	 */
	const readyInput = () => {
		if (inputRef.current) {
			inputRef.current.scrollIntoView({ behavior: 'auto' });
			inputRef.current.focus();
		}
	};

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onFocusInput event handler.
		disposableStore.add(props.positronConsoleInstance.onFocusInput(() => {
			// Ready the input.
			readyInput();
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.positronConsoleInstance]);

	// useEffect hook that gets the input scrolled into view and focused.
	useEffect(() => {
		// Ready the input.
		readyInput();
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

		// Determine that a key is pressed without any modifiers
		const noModifierKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

		// Determine whether the ctrl key is pressed without other modifiers.
		const onlyCtrlKey = e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

		// Determine whether the cmd or ctrl key is pressed without other modifiers.
		const onlyCmdOrCtrlKey = (isMacintosh ? e.metaKey : e.ctrlKey) &&
			(isMacintosh ? !e.ctrlKey : !e.metaKey) &&
			!e.shiftKey &&
			!e.altKey;

		if (noModifierKey) {
			switch (e.key) {
				// Enter key.
				case 'Enter': {
					// Consume the event.
					consumeEvent();

					// Reply to the prompt.
					props.positronConsoleInstance.replyToPrompt(inputRef.current?.value);
					return;
				}

				default: {
					return;
				}
			}
		}

		if (onlyCtrlKey) {
			switch (e.key) {
				// C key.
				case 'c': {
					consumeEvent();
					props.positronConsoleInstance.interrupt();
					return;
				}

				default: {
					return;
				}
			}
		}

		if (onlyCmdOrCtrlKey) {
			switch (e.key) {
				// Select all handler
				case 'a': {
					consumeEvent();

					const input = inputRef.current;
					if (!input) {
						return;
					}

					inputRef.current.selectionStart = 0;
					inputRef.current.selectionEnd = input.value.length;

					return;
				}

				// Paste handler
				case 'v': {
					// This is a stopgap implementation. Because we are
					// manipulating the HTML directly, undo/redo does not work
					// as expected after pasting.
					consumeEvent();

					const input = inputRef.current;
					if (!input) {
						return;
					}

					const clipboard = await services.clipboardService.readText();

					const start = input.selectionStart!;
					const before = input.value.substring(0, start);
					const after = input.value.substring(input.selectionEnd!);
					inputRef.current.value = before + clipboard + after;
					inputRef.current.selectionStart = start + clipboard.length;
					inputRef.current.selectionEnd = start + clipboard.length;

					return;
				}

				default: {
					return;
				}
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
			<ConsoleOutputLines outputLines={props.activityItemPrompt.outputLines.slice(0, -1)} />
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
