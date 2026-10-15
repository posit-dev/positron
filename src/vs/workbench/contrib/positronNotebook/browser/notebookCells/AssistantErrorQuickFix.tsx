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
import { ErrorActionChat, ErrorActionKind, IErrorActionContext } from '../../../positronAssistant/common/errorActions.js';
import { useErrorActionHandler } from '../../../positronAssistant/browser/useErrorActionHandler.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

/**
 * Props for the AssistantErrorQuickFix component.
 */
interface AssistantErrorQuickFixProps {
	/**
	 * Resolves the error and where it was raised when a button is pressed (not
	 * at render time), so it can reflect the error source's current location.
	 */
	getErrorContext: () => Omit<IErrorActionContext, 'chat'>;
	/** Accessible label for the button group. */
	groupAriaLabel: string;
}

/**
 * Presentational "Fix" and "Explain" split buttons for an error output. Sends
 * the error to the error action handler: the primary click starts a fresh
 * conversation, the dropdown continues the current one.
 *
 * This component does no gating beyond hiding while there is no handler; each
 * caller decides whether to render it (see NotebookCellQuickFix and
 * QuartoOutputQuickFix, which apply their surface's assistant-availability
 * checks first).
 */
export const AssistantErrorQuickFix = (props: AssistantErrorQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { contextMenuService } = services;
	const handler = useErrorActionHandler();

	const { getErrorContext } = props;

	// Resolve the error context when a button is pressed (not at render time) so
	// the provider can report the error source's current location.
	const run = useCallback((kind: ErrorActionKind, chat: ErrorActionChat) => {
		return handler?.run(kind, { ...getErrorContext(), chat });
	}, [handler, getErrorContext]);

	const pressedFixHandler = () => run('fix', 'new');

	const pressedExplainHandler = () => run('explain', 'new');

	// Memoize dropdown actions for Fix button
	const fixDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronAssistantFixInCurrentChat', "Ask assistant to fix in current chat"),
			tooltip: localize('positronAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => run('fix', 'current')
		}
	], [run]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronAssistantExplainInCurrentChat', "Ask assistant to explain in current chat"),
			tooltip: localize('positronAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => run('explain', 'current')
		}
	], [run]);

	// Tooltip strings
	const fixTooltip = localize('positronAssistantFixTooltip', "Ask assistant to fix in new chat");
	const fixDropdownTooltip = localize('positronAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronAssistantExplainTooltip', "Ask assistant to explain in new chat");
	const explainDropdownTooltip = localize('positronAssistantExplainDropdownTooltip', "More explain options");

	if (!handler) {
		return null;
	}

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
