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
import { usePositronConfiguration } from '../../../../../base/browser/positronReactHooks.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { useErrorActionHandler } from '../../../positronAssistant/browser/useErrorActionHandler.js';
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
	// Undefined when there is nowhere to send the error, e.g. Posit Assistant
	// has no usable chat model and no other handler is registered.
	const errorActionHandler = useErrorActionHandler();
	const showAssistantActions = aiEnabled && enableAssistantActions;

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
							{showAssistantActions && errorActionHandler &&
								<ConsoleQuickFix code={props.code} errorActionHandler={errorActionHandler} outputLines={props.activityItemErrorMessage.messageOutputLines} positronConsoleInstance={props.positronConsoleInstance} tracebackLines={props.activityItemErrorMessage.tracebackOutputLines} />
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
