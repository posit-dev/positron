/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './AssistantErrorQuickFix.css';

// React.
import { useCallback, useMemo } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IAction } from '../../../../../base/common/actions.js';
import { ErrorActionChat, ErrorActionKind, IErrorActionHandler, IErrorDetails } from '../../../positronAssistant/common/errorActions.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

/**
 * Props for the AssistantErrorQuickFix component.
 */
interface AssistantErrorQuickFixProps {
	/** The error action handler the error is sent to. */
	handler: IErrorActionHandler;
	/**
	 * Resolves the error and where it was raised when a button is pressed (not
	 * at render time), so it can reflect the error source's current location.
	 */
	getErrorDetails: () => IErrorDetails;
	/** Accessible label for the button group. */
	groupAriaLabel: string;
}

/**
 * Presentational "Fix" and "Explain" split buttons for an error output. Sends
 * the error to the given error action handler: the primary click starts a
 * fresh conversation, the dropdown continues the current one.
 *
 * This component does no gating; each caller decides whether to render it and
 * passes the active handler (see NotebookCellQuickFix and QuartoOutputQuickFix).
 */
export const AssistantErrorQuickFix = (props: AssistantErrorQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { contextMenuService } = services;

	const { handler, getErrorDetails } = props;
	const { label, canContinueChat } = handler;

	// Resolve the error details when a button is pressed (not at render time) so
	// the provider can report the error source's current location.
	const run = useCallback((kind: ErrorActionKind, chat: ErrorActionChat) => {
		return handler.run(kind, { ...getErrorDetails(), chat });
	}, [handler, getErrorDetails]);

	const pressedFixHandler = () => run('fix', 'new');

	const pressedExplainHandler = () => run('explain', 'new');

	// Memoize dropdown actions for Fix button. None while the handler can't
	// continue the current chat, which hides the dropdown.
	const fixDropdownActions = useMemo((): IAction[] => canContinueChat ? [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronErrorActionsFixInCurrentChat', "Ask {0} to fix in current chat", label),
			tooltip: localize('positronAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => run('fix', 'current')
		}
	] : [], [canContinueChat, label, run]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => canContinueChat ? [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronErrorActionsExplainInCurrentChat', "Ask {0} to explain in current chat", label),
			tooltip: localize('positronAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => run('explain', 'current')
		}
	] : [], [canContinueChat, label, run]);

	// Tooltip strings
	const fixTooltip = localize('positronErrorActionsFixTooltip', "Ask {0} to fix in new chat", label);
	const fixDropdownTooltip = localize('positronAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronErrorActionsExplainTooltip', "Ask {0} to explain in new chat", label);
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
