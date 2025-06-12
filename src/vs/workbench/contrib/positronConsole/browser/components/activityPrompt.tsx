/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityPrompt.css';

// React.
import React, { KeyboardEvent, useEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../../base/browser/pixelRatio.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ActivityItemPrompt, ActivityItemPromptState } from '../../../../services/positronConsole/browser/classes/activityItemPrompt.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { BareFontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { FontMeasurements } from '../../../../../editor/browser/config/fontMeasurements.js';
import { applyFontInfo } from '../../../../../editor/browser/config/domFontInfo.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

// ActivityPromptProps interface.
export interface ActivityPromptProps {
	activityItemPrompt: ActivityItemPrompt;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * Gets the font info for the console, with fallback to terminal font settings.
 *
 * @param configurationService The configuration service.
 *
 * @returns The font info.
 */
const getConsoleFontInfo = (configurationService: IConfigurationService) => {
	// Get the console and terminal options
	const terminalConfig = configurationService.getValue<any>('terminal.integrated');
	const consoleFontFamily = configurationService.getValue<string>('console.fontFamily');
	const consoleFontSize = configurationService.getValue<number>('console.fontSize');
	const consoleLineHeight = configurationService.getValue<number>('console.lineHeight');
	const consoleLetterSpacing = configurationService.getValue<number>('console.letterSpacing');
	const consoleFontWeight = configurationService.getValue<number | string>('console.fontWeight');
	const consoleFontLigaturesEnabled = configurationService.getValue<boolean>('console.fontLigatures.enabled');

	// Create console-specific options, falling back to terminal settings
	const consoleOptions = {
		fontFamily: consoleFontFamily || terminalConfig.fontFamily,
		fontSize: consoleFontSize,
		lineHeight: consoleLineHeight,
		letterSpacing: consoleLetterSpacing,
		fontWeight: consoleFontWeight ? String(consoleFontWeight) : terminalConfig.fontWeight,
		fontWeightBold: consoleFontWeight ? String(consoleFontWeight) : terminalConfig.fontWeight,
		fontLigatures: consoleFontLigaturesEnabled,
		fontVariations: false // Terminal doesn't use fontVariations like editor
	};

	// Use the active window
	const window = DOM.getActiveWindow();

	return FontMeasurements.readFontInfo(
		window,
		BareFontInfo.createFromRawSettings(consoleOptions, PixelRatio.getInstance(window).value)
	);
};

/**
 * ActivityPrompt component.
 * @param props An ActivityPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityPrompt = (props: ActivityPromptProps) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Get services from the context.
	const { openerService, notificationService, environmentService, pathService, clipboardService, configurationService } = usePositronConsoleContext();

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

		// Add configuration change listener to update font when console settings change
		disposableStore.add(configurationService.onDidChangeConfiguration(configurationChangeEvent => {
			if (configurationChangeEvent.affectsConfiguration('console') ||
				configurationChangeEvent.affectsConfiguration('terminal.integrated')) {
				if (inputRef.current) {
					const fontInfo = getConsoleFontInfo(configurationService);
					applyFontInfo(inputRef.current, fontInfo);
				}
			}
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.positronConsoleInstance, configurationService]);

	// useEffect hook that gets the input scrolled into view and focused.
	useEffect(() => {
		// Ready the input.
		readyInput();

		// Apply console font info to the input field
		if (inputRef.current) {
			const fontInfo = getConsoleFontInfo(configurationService);
			applyFontInfo(inputRef.current, fontInfo);
		}
	}, [inputRef, configurationService]);


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

					const clipboard = await clipboardService.readText();

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
						<OutputRun
							key={outputRun.id}
							environmentService={environmentService}
							notificationService={notificationService}
							openerService={openerService}
							outputRun={outputRun}
							pathService={pathService}
						/>
					)
				)}
				{prompt}
			</div>
		</div>
	);
};
