/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import './activityErrorQuickFix.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { ActionListItemKind, IActionListDelegate } from '../../../../../platform/actionWidget/browser/actionList.js';
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const fixPrompt = localize('positronConsoleErrorFixPrompt', "You are going to provide a quick fix for a Positron Console error. The Console session is attached. Provide the user an code snippet that can be applied to the Positron Console to fix the error, or explain why the error is occurring only if you cannot resolve it on your own.");
const explainPrompt = localize('positronConsoleErrorExplainPrompt', "You are going to provide an explanation for a Positron Console error. The Console session is attached. Provide the user an explanation of why the error is occurring, and how they can resolve it. Do not provide a code snippet unless it is necessary to explain the error.");


/**
 * Quick fix component.
 * @returns The rendered component.
 */
export const ConsoleQuickFix = ({ parent }: { parent: HTMLElement }) => {
	const buttonRef = useRef<HTMLDivElement>(undefined!);
	const { actionWidgetService, quickChatService } = usePositronReactServicesContext();
	/**
	 * onClick handler.
	 */
	enum ActionEnum {
		Fix = 'fix',
		Explain = 'explain'
	}
	const pressedHandler = async () => {
		const delegate: IActionListDelegate<ActionEnum> = {
			onHide: function (didCancel?: boolean): void {
			},
			onSelect: function (action: ActionEnum, preview?: boolean): void {
				switch (action) {
					case ActionEnum.Fix:
						// Handle console quick fix action.
						quickChatService.open({ query: fixPrompt });
						break;
					case ActionEnum.Explain:
						quickChatService.open({ query: explainPrompt });
						break;
				}

			}
		}
		actionWidgetService.show(
			'consoleActionWidget',
			false,
			[
				{
					label: localize('positronConsoleQuickFixHeader', "Quick Fix"),
					kind: ActionListItemKind.Header
				},
				{
					label: localize('positronConsoleFixWithAssistant', "Fix with Assistant"),
					kind: ActionListItemKind.Action,
					item: ActionEnum.Fix,
					disabled: false,
				},
				{
					label: localize('positronConsoleExplainWithAssistant', "Explain with Assistant"),
					kind: ActionListItemKind.Action,
					item: ActionEnum.Explain,
					disabled: false,
				}
			],
			delegate,
			buttonRef.current,
			parent,
			[]
		)
	};

	// Render.
	return (
		<div className='quick-fix'>
			<PositronButton className='apply-quick-fix' onPressed={pressedHandler}>
				<div ref={buttonRef} className='link-text'>{localize('positronConsoleQuickFix', "Quick Fix...")}</div>
			</PositronButton>
		</div>
	);
};
