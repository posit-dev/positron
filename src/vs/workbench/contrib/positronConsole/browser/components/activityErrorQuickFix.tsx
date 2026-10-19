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
import { ErrorActionKind, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { useActiveErrorActionHandler } from '../../../positronAssistant/browser/useActiveErrorActionHandler.js';

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
	const handler = useActiveErrorActionHandler();

	if (!handler) {
		return null;
	}

	// Continue the current chat when the handler can, for follow-ups on
	// earlier console work.
	const run = (kind: ErrorActionKind) => services.get(IErrorActionsService).run(handler, kind, {
		error: formatOutput(props.outputLines, props.tracebackLines),
		location: { kind: 'console' },
		chat: handler.canContinueChat ? 'current' : 'new',
	});

	const pressedFixHandler = () => run('fix');

	const pressedExplainHandler = () => run('explain');

	// Name the handler errors are sent to.
	const fixTooltip = localize('positronConsoleErrorActionsFixTooltip', "Ask {0} to fix", handler.label);
	const explainTooltip = localize('positronConsoleErrorActionsExplainTooltip', "Ask {0} to explain", handler.label);

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
