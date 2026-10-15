/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './activityErrorQuickFix.css';

// React.
import { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { ErrorActionKind } from '../../../positronAssistant/common/errorActions.js';
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
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const handler = useActiveErrorActionHandler();

	if (!handler) {
		return null;
	}

	// Continue the current chat when the handler can, for follow-ups on
	// earlier console work.
	const run = (kind: ErrorActionKind) => handler.run(kind, {
		error: formatOutput(props.outputLines, props.tracebackLines),
		location: { kind: 'console' },
		chat: handler.canContinueChat ? 'current' : 'new',
	});

	const pressedFixHandler = () => run('fix');

	const pressedExplainHandler = () => run('explain');

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
