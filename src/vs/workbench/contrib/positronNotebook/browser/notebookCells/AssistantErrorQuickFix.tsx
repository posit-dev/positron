/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantErrorQuickFix.css';

// React.

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IAction, toAction } from '../../../../../base/common/actions.js';
import { ErrorAssistantAction, IErrorAssistantContext, IErrorAssistantInfo, IErrorAssistantService } from '../../../positronAssistant/common/errorAssistant.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

/**
 * Props for the AssistantErrorQuickFix component.
 */
interface AssistantErrorQuickFixProps {
	/** The assistant the error is sent to. */
	assistant: IErrorAssistantInfo;
	/**
	 * Resolves the error and where it was raised when a button is pressed (not
	 * at render time), so it can reflect the error source's current location.
	 */
	getErrorContext: () => IErrorAssistantContext;
	/** Accessible label for the button group. */
	groupAriaLabel: string;
}

/**
 * Presentational "Fix" and "Explain" split buttons for an error output. Sends
 * the error to the given assistant: the primary click starts a new chat, the
 * dropdown continues the active one.
 *
 * This component does no gating; each caller decides whether to render it and
 * passes the active assistant (see NotebookCellQuickFix and QuartoOutputQuickFix).
 */
export const AssistantErrorQuickFix = (props: AssistantErrorQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { contextMenuService } = services;

	const { assistant, getErrorContext } = props;
	const { id, label, supportsChatContinuation } = assistant;

	// Resolve the error context when a button is pressed (not at render time)
	// so it reflects the error source's current location.
	const ask = (action: ErrorAssistantAction, continueChat: boolean) =>
		services.get(IErrorAssistantService).ask(id, action, getErrorContext(), { continueChat });

	const pressedFixHandler = () => ask('fix', false);

	const pressedExplainHandler = () => ask('explain', false);

	// Each dropdown continues the active chat. None while the assistant can't,
	// which hides the dropdown.
	const continueChatActions = (action: ErrorAssistantAction, actionLabel: string, tooltip: string): IAction[] =>
		supportsChatContinuation
			? [toAction({ id: 'continue-in-existing-chat', label: actionLabel, tooltip, run: () => ask(action, true) })]
			: [];
	const fixDropdownActions = continueChatActions(
		'fix',
		localize('positronErrorAssistantFixInCurrentChat', "Ask {0} to fix in current chat", label),
		localize('positronAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
	);
	const explainDropdownActions = continueChatActions(
		'explain',
		localize('positronErrorAssistantExplainInCurrentChat', "Ask {0} to explain in current chat", label),
		localize('positronAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
	);

	// Tooltip strings
	const fixTooltip = localize('positronErrorAssistantFixTooltip', "Ask {0} to fix in new chat", label);
	const fixDropdownTooltip = localize('positronAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronErrorAssistantExplainTooltip', "Ask {0} to explain in new chat", label);
	const explainDropdownTooltip = localize('positronAssistantExplainDropdownTooltip', "More explain options");

	// Render.
	return (
		<div
			aria-label={props.groupAriaLabel}
			className='assistant-error-quick-fix'
			role='group'
		>
			{/* Fix button with split dropdown */}
			<SplitButton
				ariaLabel={fixTooltip}
				className='assistant-error-quick-fix-split-button'
				contextMenuService={contextMenuService}
				dropdownActions={fixDropdownActions}
				dropdownIconClass='codicon-positron-drop-down-arrow'
				dropdownTooltip={fixDropdownTooltip}
				onMainAction={pressedFixHandler}
			>
				<div className='link-text' title={fixTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronAssistantFix', "Fix")}
				</div>
			</SplitButton>

			{/* Explain button with split dropdown */}
			<SplitButton
				ariaLabel={explainTooltip}
				className='assistant-error-quick-fix-split-button'
				contextMenuService={contextMenuService}
				dropdownActions={explainDropdownActions}
				dropdownIconClass='codicon-positron-drop-down-arrow'
				dropdownTooltip={explainDropdownTooltip}
				onMainAction={pressedExplainHandler}
			>
				<div className='link-text' title={explainTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronAssistantExplain', "Explain")}
				</div>
			</SplitButton>
		</div>
	);
};
