/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './activityErrorQuickFix.css';

// React.
import React, { useMemo, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

const fixPrompt = '/fix';
const explainPrompt = '/explain';

interface ConsoleQuickFixProps {
	outputLines: ANSIOutputLine[];
	tracebackLines: ANSIOutputLine[];
}

const formatOutput = (outputLines: ANSIOutputLine[], tracebackLines: ANSIOutputLine[]) => {
	return outputLines.map(line => line.outputRuns.map(run => run.text).join('')).join('\n') + '\n' + tracebackLines.map(line => line.outputRuns.map(run => run.text).join('')).join('\n');
};

/**
 * Quick fix component.
 * @returns The rendered component.
 */
export const ConsoleQuickFix = (props: ConsoleQuickFixProps) => {
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const { quickChatService } = usePositronReactServicesContext();

	const formattedOutput = useMemo(() => {
		return formatOutput(props.outputLines, props.tracebackLines);
	}, [props.outputLines, props.tracebackLines]);
	/**
	 * onClick handlers.
	 */
	const pressedFixHandler = async () => {
		// Handle console quick fix action.
		quickChatService.openOne({
			query: props.outputLines ? `${fixPrompt}\n\`\`\`${formattedOutput}\`\`\`` : fixPrompt,
			renderInputOnTop: false
		});
	};

	const pressedExplainHandler = async () => {
		// Handle console quick explain action.
		quickChatService.openOne({
			query: props.outputLines ? `${explainPrompt}\n\`\`\`${formattedOutput}\`\`\`` : explainPrompt,
			renderInputOnTop: false
		});
	};

	// Render.
	return (
		<div className='quick-fix'>
			<PositronButton className='assistant-action' onPressed={pressedFixHandler}>
				<div ref={buttonRef} className='link-text'>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantFix', "Fix")}
				</div>
			</PositronButton>
			<PositronButton className='assistant-action' onPressed={pressedExplainHandler}>
				<div ref={buttonRef} className='link-text'>
					<span className='codicon codicon-sparkle' />
					{localize('positronConsoleAssistantExplain', "Explain")}
				</div>
			</PositronButton>
		</div>
	);
};
