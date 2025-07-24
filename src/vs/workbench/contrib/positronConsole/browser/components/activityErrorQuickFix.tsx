/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './activityErrorQuickFix.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const fixPrompt = localize('positronConsoleErrorFixPrompt', "You are going to provide a quick fix for a Positron Console error. The Console session is attached. Provide the user an code snippet that can be applied to the Positron Console to fix the error, or explain why the error is occurring only if you cannot resolve it on your own.");
const explainPrompt = localize('positronConsoleErrorExplainPrompt', "You are going to provide an explanation for a Positron Console error. The Console session is attached. Provide the user an explanation of why the error is occurring, and how they can resolve it. Do not provide a code snippet unless it is necessary to explain the error.");


/**
 * Quick fix component.
 * @returns The rendered component.
 */
export const ConsoleQuickFix = () => {
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const { quickChatService } = usePositronReactServicesContext();
	/**
	 * onClick handlers.
	 */
	const pressedFixHandler = async () => {
		// Handle console quick fix action.
		quickChatService.open({ query: fixPrompt });
	};

	const pressedExplainHandler = async () => {
		// Handle console quick explain action.
		quickChatService.open({ query: explainPrompt });
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
