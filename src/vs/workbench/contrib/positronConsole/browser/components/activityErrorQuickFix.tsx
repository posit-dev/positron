/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './activityErrorQuickFix.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ErrorAction, IErrorActionHandlerService } from '../../../positronAssistant/common/errorAction.js';
import { useActiveErrorActionHandler } from '../../../positronAssistant/browser/useActiveErrorActionHandler.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

interface ConsoleQuickFixProps {
	outputLines: ANSIOutputLine[];
	tracebackLines: ANSIOutputLine[];
	/** The code that raised the error, when the console still has it. */
	code?: string;
	/** The console the error was raised in. */
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
 * Quick fix component.
 * @returns The rendered component.
 */
export const ConsoleQuickFix = (props: ConsoleQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const handler = useActiveErrorActionHandler();

	if (!handler) {
		return null;
	}

	// Continue the active chat when the handler can, for follow-ups on
	// earlier console work.
	const ask = (action: ErrorAction) => services.get(IErrorActionHandlerService).ask(handler.id, action, {
		kind: 'console',
		error: formatOutput(props.outputLines, props.tracebackLines),
		sessionId: props.positronConsoleInstance.sessionId,
		sessionName: props.positronConsoleInstance.sessionName,
		languageId: props.positronConsoleInstance.runtimeMetadata.languageId,
		code: props.code,
	}, { continueChat: true });

	const pressedFixHandler = () => ask('fix');

	const pressedExplainHandler = () => ask('explain');

	// Name the handler errors are sent to.
	const fixTooltip = localize('positronConsoleErrorActionFixTooltip', "Ask {0} to fix", handler.label);
	const explainTooltip = localize('positronConsoleErrorActionExplainTooltip', "Ask {0} to explain", handler.label);

	// Render.
	return (
		<div className='quick-fix'>
			<Button ariaLabel={fixTooltip} className='assistant-action' onPressed={pressedFixHandler}>
				<div className='link-text' title={fixTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantFix', "Fix")}
				</div>
			</Button>
			<Button ariaLabel={explainTooltip} className='assistant-action' onPressed={pressedExplainHandler}>
				<div className='link-text' title={explainTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantExplain', "Explain")}
				</div>
			</Button>
		</div>
	);
};
