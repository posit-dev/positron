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
import { removeAnsiEscapeCodes } from '../../../../../base/common/strings.js';
import { ErrorActionChat, ErrorActionKind, IErrorActionHandler, IErrorActionsService, IErrorLocation } from '../../../positronAssistant/common/errorActions.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

/**
 * Props for the AssistantErrorQuickFix component.
 */
interface AssistantErrorQuickFixProps {
	/** The error output, which may contain ANSI escape codes. */
	errorOutput: string;
	/**
	 * Resolves where the error came from when a button is pressed (not at
	 * render time), so the location reflects any edits since the error.
	 */
	getLocation: () => IErrorLocation | undefined;
	/** Accessible label for the button group. */
	groupAriaLabel: string;
	/** Error action handler to send the error to. */
	errorActionHandler: IErrorActionHandler;
}

/**
 * Presentational "Fix" and "Explain" split buttons for an error output. The
 * primary click sends the error to the handler in a new chat; when the
 * handler can continue the current chat, the dropdown sends it there instead.
 *
 * This component does no gating; each caller decides whether to render it (see
 * NotebookCellQuickFix and QuartoOutputQuickFix, which apply their surface's
 * checks first).
 */
export const AssistantErrorQuickFix = (props: AssistantErrorQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { contextMenuService } = services;

	const { errorOutput, getLocation, errorActionHandler } = props;

	const runAction = useCallback((kind: ErrorActionKind, chat: ErrorActionChat) => {
		return services.get(IErrorActionsService).run(errorActionHandler, kind, {
			error: removeAnsiEscapeCodes(errorOutput).trim(),
			location: getLocation(),
			chat,
		});
	}, [services, errorOutput, getLocation, errorActionHandler]);

	const pressedFixHandler = () => runAction('fix', 'new');

	const pressedExplainHandler = () => runAction('explain', 'new');

	// Memoize dropdown actions for Fix button
	const fixDropdownActions = useMemo((): IAction[] => !errorActionHandler.canContinueChat ? [] : [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronAssistantFixInCurrentChatTarget', "Ask {0} to fix in current chat", errorActionHandler.label),
			tooltip: localize('positronAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runAction('fix', 'current')
		}
	], [runAction, errorActionHandler]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => !errorActionHandler.canContinueChat ? [] : [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronAssistantExplainInCurrentChatTarget', "Ask {0} to explain in current chat", errorActionHandler.label),
			tooltip: localize('positronAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runAction('explain', 'current')
		}
	], [runAction, errorActionHandler]);

	// Tooltip strings
	const fixTooltip = localize('positronAssistantFixTargetTooltip', "Ask {0} to fix in new chat", errorActionHandler.label);
	const fixDropdownTooltip = localize('positronAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronAssistantExplainTargetTooltip', "Ask {0} to explain in new chat", errorActionHandler.label);
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
