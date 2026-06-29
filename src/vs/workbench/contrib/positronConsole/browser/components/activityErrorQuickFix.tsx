/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { NewChatFile, NewChatOptions, openPositAssistantChat } from '../../../positronAssistant/browser/positAssistantChat.js';

const fixPrompt = localize('positronConsoleAssistantFixPrompt', "Fix this console error.");
const explainPrompt = localize('positronConsoleAssistantExplainPrompt', "Explain this console error.");

const ATTACHMENT_NAME = 'console-error.txt';

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

const buildAttachment = (text: string): NewChatFile | undefined => {
	if (!text) {
		return undefined;
	}
	const base64 = encodeBase64(VSBuffer.fromString(text));
	return { uri: `data:text/plain;base64,${base64}`, name: ATTACHMENT_NAME };
};

/**
 * Quick fix component.
 * @returns The rendered component.
 */
export const ConsoleQuickFix = (props: ConsoleQuickFixProps) => {
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const services = usePositronReactServicesContext();
	const { commandService, logService, notificationService } = services;

	const attachment = useMemo(
		() => buildAttachment(formatOutput(props.outputLines, props.tracebackLines)),
		[props.outputLines, props.tracebackLines]
	);

	const runNewChat = (prompt: string) => {
		const options: NewChatOptions = {
			prompt,
			target: 'auto',
			behavior: 'submit',
			...(attachment && { files: [attachment] }),
		};
		return openPositAssistantChat(commandService, notificationService, logService, options);
	};

	const pressedFixHandler = () => runNewChat(fixPrompt);

	const pressedExplainHandler = () => runNewChat(explainPrompt);

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
