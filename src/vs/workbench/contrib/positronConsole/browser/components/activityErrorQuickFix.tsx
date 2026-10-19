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
import { ErrorAssistantAction, IErrorAssistantService } from '../../../positronAssistant/common/errorAssistant.js';
import { useActiveErrorAssistant } from '../../../positronAssistant/browser/useActiveErrorAssistant.js';

interface ConsoleQuickFixProps {
	outputLines: ANSIOutputLine[];
	tracebackLines: ANSIOutputLine[];
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
	const assistant = useActiveErrorAssistant();

	if (!assistant) {
		return null;
	}

	// Continue the active chat when the assistant can, for follow-ups on
	// earlier console work.
	const run = (action: ErrorAssistantAction) => services.get(IErrorAssistantService).run(assistant.id, action, {
		error: formatOutput(props.outputLines, props.tracebackLines),
		location: { kind: 'console' },
	}, { continueChat: assistant.supportsChatContinuation });

	const pressedFixHandler = () => run('fix');

	const pressedExplainHandler = () => run('explain');

	// Name the assistant errors are sent to.
	const fixTooltip = localize('positronConsoleErrorAssistantFixTooltip', "Ask {0} to fix", assistant.label);
	const explainTooltip = localize('positronConsoleErrorAssistantExplainTooltip', "Ask {0} to explain", assistant.label);

	// Render.
	return (
		<div className='quick-fix'>
			<Button className='assistant-action' onPressed={pressedFixHandler}>
				<div className='link-text' title={fixTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantFix', "Fix")}
				</div>
			</Button>
			<Button className='assistant-action' onPressed={pressedExplainHandler}>
				<div className='link-text' title={explainTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantExplain', "Explain")}
				</div>
			</Button>
		</div>
	);
};
