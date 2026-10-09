/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityErrorQuickFix.css';

// React.
import { useMemo, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { ErrorActionKind, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { useErrorActionHandler } from '../../../positronAssistant/browser/useErrorActionHandler.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

interface ConsoleErrorActionsProps {
	outputLines: ANSIOutputLine[];
	tracebackLines: ANSIOutputLine[];
	/** Code whose execution raised the error, when known. */
	code?: string;
	/** Console the error was raised in. */
	positronConsoleInstance: IPositronConsoleInstance;
}

const formatOutput = (outputLines: ANSIOutputLine[], tracebackLines: ANSIOutputLine[]) => {
	const lineText = (lines: ANSIOutputLine[]) =>
		lines.map(line => line.outputRuns.map(run => run.text).join('')).join('\n');
	const message = lineText(outputLines);
	const traceback = lineText(tracebackLines);
	return traceback ? `${message}\n${traceback}` : message;
};

/**
 * Fix and Explain buttons for a console error that send it to the selected
 * error action handler. Renders nothing when there is nowhere to send it,
 * e.g. Posit Assistant has no usable chat model and no other handler is
 * registered.
 *
 * Replaces `ConsoleQuickFix` while `ai.errorActions.agents.enabled` is on.
 */
export const ConsoleErrorActions = (props: ConsoleErrorActionsProps) => {
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const services = usePositronReactServicesContext();
	const configuredHandler = useErrorActionHandler();

	const errorText = useMemo(
		() => formatOutput(props.outputLines, props.tracebackLines),
		[props.outputLines, props.tracebackLines]
	);

	if (!configuredHandler) {
		return null;
	}

	// The console's errors usually follow on from the conversation the user is
	// having, so they continue the current chat when the handler can.
	const runAction = (kind: ErrorActionKind) => {
		const { positronConsoleInstance } = props;
		return services.get(IErrorActionsService).run(configuredHandler.handler, kind, {
			error: errorText,
			location: {
				kind: 'console',
				sessionId: positronConsoleInstance.sessionId,
				sessionName: positronConsoleInstance.sessionName,
				languageId: positronConsoleInstance.runtimeMetadata.languageId,
				code: props.code,
			},
			chat: configuredHandler.canContinueChat ? 'current' : 'new',
		});
	};

	const pressedFixHandler = () => runAction('fix');

	const pressedExplainHandler = () => runAction('explain');

	// Render.
	return (
		<div className='quick-fix'>
			<Button className='assistant-action' onPressed={pressedFixHandler}>
				<div ref={buttonRef} className='link-text'>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantFix', "Fix")}
				</div>
			</Button>
			<Button className='assistant-action' onPressed={pressedExplainHandler}>
				<div ref={buttonRef} className='link-text'>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantExplain', "Explain")}
				</div>
			</Button>
		</div>
	);
};
