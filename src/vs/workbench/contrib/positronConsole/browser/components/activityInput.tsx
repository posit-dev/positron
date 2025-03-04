/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityInput.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { ttPolicy } from '../positronConsole.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { LineTokens } from '../../../../../editor/common/tokens/lineTokens.js';
import { ViewLineRenderingData } from '../../../../../editor/common/viewModel.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { RenderLineInput, renderViewLine2 } from '../../../../../editor/common/viewLayout/viewLineRenderer.js';
import { ILanguageIdCodec, ITokenizationSupport, TokenizationRegistry } from '../../../../../editor/common/languages.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ActivityItemInput, ActivityItemInputState } from '../../../../services/positronConsole/browser/classes/activityItemInput.js';

/**
 * Colorizes code output lines.
 * @param codeOutputLines The code output lines to colorize.
 * @param tokenizationSupport The tokenization support.
 * @param languageIdCodec The language ID codec.
 * @returns The colorized code output lines.
 */
const colorizeCodeOutoutLines = (
	codeOutputLines: string[],
	tokenizationSupport: ITokenizationSupport,
	languageIdCodec: ILanguageIdCodec
) => {
	// The colorized output lines.
	const colorizedOutputLines: TrustedHTML[] = [];

	// If the trusted type policy is not available, return.
	if (!ttPolicy) {
		return colorizedOutputLines;
	}

	// Set the initial state.
	let state = tokenizationSupport.getInitialState();

	// Iterate over the code output lines and colorize them.
	codeOutputLines.forEach(codeOutputLine => {
		// Create the render line input.
		const tokenizeResult = tokenizationSupport.tokenizeEncoded(codeOutputLine, true, state);
		LineTokens.convertToEndOffset(tokenizeResult.tokens, codeOutputLine.length);
		const lineTokens = new LineTokens(tokenizeResult.tokens, codeOutputLine, languageIdCodec);
		const isBasicASCII = ViewLineRenderingData.isBasicASCII(codeOutputLine, /* check for basic ASCII */true);
		const containsRTL = ViewLineRenderingData.containsRTL(codeOutputLine, isBasicASCII, /* check for RTL */true);
		const renderLineInput = new RenderLineInput(
			false,
			true,
			codeOutputLine,
			false,
			isBasicASCII,
			containsRTL,
			0,
			lineTokens.inflate(),
			[],
			0,
			0,
			0,
			0,
			0,
			-1,
			'none',
			false,
			false,
			null
		);

		// Render the render line input.
		const renderLineOutput = renderViewLine2(renderLineInput);

		// Create and push the colorized output line.
		colorizedOutputLines.push(ttPolicy!.createHTML(renderLineOutput.html));

		// Update the state for the next code output line.
		state = tokenizeResult.endState;
	});

	// Return the colorized output lines.
	return colorizedOutputLines;
};

// ActivityInputProps interface.
export interface ActivityInputProps {
	fontInfo: FontInfo;
	activityItemInput: ActivityItemInput;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ActivityInput component.
 * @param props An ActivityInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityInput = (props: ActivityInputProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// State hooks.
	const [state, setState] = useState(props.activityItemInput.state);
	const [colorizedOutputLines, setColorizedOutputLines] = useState<TrustedHTML[]>([]);

	// Main useEffect for event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Listen for state changes to the item.
		disposableStore.add(props.activityItemInput.onStateChanged(() => {
			setState(props.activityItemInput.state);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.activityItemInput]);

	// Colorize the lines useEffect.
	useEffect(() => {
		/**
		 * Colorizes the lines.
		 */
		const colorizeLines = async () => {
			// If there isn't an attached runtime, clear the colorized lines and return.
			if (!props.positronConsoleInstance.attachedRuntimeSession) {
				setColorizedOutputLines([]);
				return;
			}

			// Get the tokenization support. This appears to be an async operation, but in practice,
			// it is synchronous because the tokenization support is cached.
			const tokenizationSupport = await TokenizationRegistry.getOrCreate(
				props.positronConsoleInstance.attachedRuntimeSession.runtimeMetadata.languageId
			);

			// If there isn't tokenization support, clear the colorized lines and return.
			if (!tokenizationSupport) {
				setColorizedOutputLines([]);
				return;
			}

			// Built the code output lines to colorize.
			const codeOutputLines: string[] = [];
			for (let i = 0; i < props.activityItemInput.codeOutputLines.length; i++) {
				// Get the output runs for the code output line.
				const outputRuns = props.activityItemInput.codeOutputLines[i].outputRuns;

				// If there are no output runs, add an empty code output line. If there is only one
				// output run and it has no format, add the output run text as the code output line.
				// Otherwise, clear the colorized lines and return because the output line already
				// has formatting for some reason.
				if (outputRuns.length === 0) {
					codeOutputLines.push('');
				} else if (outputRuns.length === 1 && outputRuns[0].format === undefined) {
					codeOutputLines.push(outputRuns[0].text);
				} else {
					setColorizedOutputLines([]);
					return;
				}
			}

			// Colorize the output lines.
			setColorizedOutputLines(colorizeCodeOutoutLines(
				codeOutputLines,
				tokenizationSupport,
				positronConsoleContext.languageService.languageIdCodec
			));
		};

		// Colorize the lines.
		colorizeLines();
	}, [positronConsoleContext.languageService.languageIdCodec, props.activityItemInput.codeOutputLines, props.positronConsoleInstance.attachedRuntimeSession]);

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

	/**
	 * Prompt component.
	 * @param index The prompt index.
	 * @returns The rendered component.
	 */
	const Prompt = ({ index }: { index: number }) => {
		return (
			<span className='prompt' style={{ width: promptWidth }}>
				{(index === 0 ?
					props.activityItemInput.inputPrompt :
					props.activityItemInput.continuationPrompt) + ' '
				}
			</span>
		);
	}

	// Render lines.
	if (colorizedOutputLines.length) {
		// Render colorized lines.
		return (
			<div className={classNames}>
				{state === ActivityItemInputState.Executing && <div className='progress-bar' />}
				{colorizedOutputLines.map((outputLine, index) =>
					<div key={`outputLine-${index}`}>
						<Prompt index={index} />
						<span
							dangerouslySetInnerHTML={{ __html: outputLine }}
							key={`colorizedOutputLine-${index}`}
						/>
					</div>
				)}
			</div>
		);
	} else {
		// Render non-colorized lines.
		return (
			<div className={classNames}>
				{state === ActivityItemInputState.Executing && <div className='progress-bar' />}
				{props.activityItemInput.codeOutputLines.map((outputLine, index) =>
					<div key={outputLine.id}>
						<Prompt index={index} />
						{outputLine.outputRuns.map(outputRun =>
							<OutputRun
								key={outputRun.id}
								notificationService={positronConsoleContext.notificationService}
								openerService={positronConsoleContext.openerService}
								outputRun={outputRun}
							/>
						)}
					</div>
				)}
			</div>
		);
	}
};
