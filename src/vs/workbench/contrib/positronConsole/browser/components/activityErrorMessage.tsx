/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityErrorMessage.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { ConsoleQuickFix } from './activityErrorQuickFix.js';
import { usePositronConfiguration, useContextKeyFromString, usePositronExtensionInstalled } from '../../../../../base/browser/positronReactHooks.js';

// ActivityErrorProps interface.
export interface ActivityErrorMessageProps {
	activityItemErrorMessage: ActivityItemErrorMessage;
}

/**
 * ActivityErrorMessage component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityErrorMessage = (props: ActivityErrorMessageProps) => {
	// Reference hooks.
	const activityErrorMessageRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [showTraceback, setShowTraceback] = useState(false);

	// Configuration hooks.
	const enableAssistantActions = usePositronConfiguration<boolean>('positron.assistant.consoleActions.enable');
	const positAssistantInstalled = usePositronExtensionInstalled('posit.assistant');
	// Set by the built-in positron-assistant extension when any direct provider
	// or vscode.lm model is available. Posit Assistant shares the same
	// vscode.authentication credentials, so a true value here implies it has at
	// least one usable provider too.
	// TODO: When Positron Assistant is deprecated in favor of Posit Assistant,
	// replace this with a signal owned by Posit Assistant (context key or
	// equivalent) - this key goes away with the built-in extension.
	const hasChatModels = useContextKeyFromString<boolean>('positron-assistant.hasChatModels');
	const showAssistantActions = enableAssistantActions && positAssistantInstalled && !!hasChatModels;

	// Traceback useEffect.
	useEffect(() => {
		// Ensure that the component is scrolled into view when traceback is showing.
		if (showTraceback) {
			activityErrorMessageRef.current?.scrollIntoView({ behavior: 'auto' });
		}
	}, [showTraceback]);

	const pressedTracebackHandler = () => {
		// Toggle show traceback.
		setShowTraceback(!showTraceback);
	};

	// Render.
	return (
		<div ref={activityErrorMessageRef} className='activity-error-message'>
			<div className='error-bar'></div>
			<div className='error-information'>
				{props.activityItemErrorMessage.messageOutputLines.length > 0 &&
					<ConsoleOutputLines outputLines={props.activityItemErrorMessage.messageOutputLines} />
				}
				<div className='error-footer'>
					<div className='traceback'>
						<div className='actions'>
							{props.activityItemErrorMessage.tracebackOutputLines.length > 0 &&
								<Button className='toggle-traceback' onPressed={pressedTracebackHandler}>
									{showTraceback ?
										<>
											<div className='expansion-indicator codicon codicon-positron-triangle-down'></div>
											<div className='link-text'>{localize('positronHideTraceback', "Hide Traceback")}</div>

										</> :
										<>
											<div className='expansion-indicator codicon codicon-positron-triangle-right'></div>
											<div className='link-text'>{localize('positronShowTraceback', "Show Traceback")}</div>
										</>
									}
								</Button>
							}
							{showAssistantActions &&
								<ConsoleQuickFix outputLines={props.activityItemErrorMessage.messageOutputLines} tracebackLines={props.activityItemErrorMessage.tracebackOutputLines} />
							}
						</div>
						{showTraceback &&
							<div className='traceback-lines'>
								<div />
								<div>
									<ConsoleOutputLines outputLines={props.activityItemErrorMessage.tracebackOutputLines} />
								</div>
							</div>
						}
					</div>
				</div>
			</div>
		</div>
	);
};
