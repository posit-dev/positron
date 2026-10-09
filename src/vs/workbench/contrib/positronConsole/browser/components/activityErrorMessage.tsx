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
import { AI_ENABLED_KEY, ERROR_ACTIONS_AGENTS_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { ConsoleErrorActions } from './activityErrorActions.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

// ActivityErrorProps interface.
export interface ActivityErrorMessageProps {
	activityItemErrorMessage: ActivityItemErrorMessage;
	/** Code whose execution raised the error, when known. */
	code?: string;
	/** Console the error was raised in. */
	positronConsoleInstance: IPositronConsoleInstance;
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
	// Main switch for Positron's AI features.
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	const enableAssistantActions = usePositronConfiguration<boolean>('console.assistantActions.enabled');
	const positAssistantInstalled = usePositronExtensionInstalled('posit.assistant');
	// Set by the Posit Assistant extension when it has at least one usable model
	// (a configured cloud provider, a local provider, or a vscode.lm model such
	// as Copilot). This is the authoritative, assistant-agnostic signal. The key
	// string is mirrored in the Posit Assistant extension (the two repositories
	// cannot share a module).
	const hasChatModels = useContextKeyFromString<boolean>('posit-assistant.hasChatModels');
	const showAssistantActions = aiEnabled && enableAssistantActions && positAssistantInstalled && !!hasChatModels;
	// While on, ConsoleErrorActions replaces ConsoleQuickFix and decides itself
	// whether there is somewhere to send the error.
	const errorActionsAgentsEnabled = usePositronConfiguration<boolean>(ERROR_ACTIONS_AGENTS_ENABLED_KEY);

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
							{errorActionsAgentsEnabled === true
								? aiEnabled && enableAssistantActions &&
								<ConsoleErrorActions code={props.code} outputLines={props.activityItemErrorMessage.messageOutputLines} positronConsoleInstance={props.positronConsoleInstance} tracebackLines={props.activityItemErrorMessage.tracebackOutputLines} />
								: showAssistantActions &&
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
