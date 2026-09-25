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
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { openPositAssistantChat } from '../../../positronAssistant/browser/positAssistantChat.js';
import { IErrorActionTarget, IErrorActionTargetService } from '../../../positronAssistant/common/errorActionTargets.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

// Appended to every Explain prompt. Without it, an agentic assistant treats
// "Explain this error" plus an attached traceback as license to fix it too.
const explainOnlyConstraint = localize('positronAssistantExplainOnlyConstraint', "Do not make changes or edit any files; just explain the error.");

/**
 * A prompt/attachment payload resolved when a quick-fix button is pressed.
 */
export interface AssistantErrorPayload {
	/** Prompt sent when the user presses Fix. */
	fixPrompt: string;
	/**
	 * Prompt sent when the user presses Explain; the component appends the
	 * explain-only constraint to it.
	 */
	explainPrompt: string;
	/** Attachment body describing the error. */
	attachmentContent: string;
}

/**
 * Props for the AssistantErrorQuickFix component.
 */
interface AssistantErrorQuickFixProps {
	/**
	 * Resolves the prompts and attachment when a button is pressed (not at
	 * render time), so the payload can reflect the error source's current
	 * location. Each caller owns its own fallback for an error source that
	 * can no longer be found.
	 */
	getPayload: () => AssistantErrorPayload;
	/** Display name for the error attachment (e.g. 'Notebook Cell Error'). */
	attachmentName: string;
	/** Accessible label for the button group. */
	groupAriaLabel: string;
	/**
	 * Contributed target to send the error to (e.g. Claude Code). When
	 * undefined, the error goes to Posit Assistant.
	 */
	target?: IErrorActionTarget;
}

/**
 * Presentational "Fix" and "Explain" split buttons for an error output. Sends
 * the error content to Posit Assistant via posit-assistant.newChat: the primary
 * click starts a fresh conversation, the dropdown continues the current one.
 * A contributed target gets the error through its own command instead.
 *
 * This component does no gating; each caller decides whether to render it (see
 * NotebookCellQuickFix and QuartoOutputQuickFix, which apply their surface's
 * assistant-availability checks first).
 */
export const AssistantErrorQuickFix = (props: AssistantErrorQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { commandService, contextMenuService, logService, notificationService } = services;

	const { attachmentName, getPayload, target } = props;

	// Resolve the payload when a button is pressed (not at render time) so the
	// provider can report the error source's current location.
	const runNewChat = useCallback((action: 'fix' | 'explain', chatTarget: 'new' | 'auto') => {
		const payload = getPayload();
		const prompt = action === 'fix'
			? payload.fixPrompt
			: `${payload.explainPrompt} ${explainOnlyConstraint}`;
		const content = removeAnsiEscapeCodes(payload.attachmentContent).trim();

		// Send to a contributed target (e.g. Claude Code) when one is selected.
		if (target) {
			return services.get(IErrorActionTargetService).run(target, {
				action,
				conversation: chatTarget === 'new' ? 'new' : 'current',
				prompt,
				context: content,
				contextName: attachmentName,
			});
		}

		const attachment = content
			? { uri: `data:text/plain;base64,${encodeBase64(VSBuffer.fromString(content))}`, name: attachmentName }
			: undefined;
		return openPositAssistantChat(commandService, notificationService, logService, {
			prompt,
			target: chatTarget,
			behavior: 'submit',
			...(attachment && { files: [attachment] }),
		});
	}, [services, commandService, logService, notificationService, getPayload, attachmentName, target]);

	const pressedFixHandler = () => runNewChat('fix', 'new');

	const pressedExplainHandler = () => runNewChat('explain', 'new');

	// Memoize dropdown actions for Fix button
	const fixDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: target
				? localize('positronAssistantFixInCurrentChatTarget', "Ask {0} to fix in current chat", target.label)
				: localize('positronAssistantFixInCurrentChat', "Ask assistant to fix in current chat"),
			tooltip: localize('positronAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runNewChat('fix', 'auto')
		}
	], [runNewChat, target]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: target
				? localize('positronAssistantExplainInCurrentChatTarget', "Ask {0} to explain in current chat", target.label)
				: localize('positronAssistantExplainInCurrentChat', "Ask assistant to explain in current chat"),
			tooltip: localize('positronAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runNewChat('explain', 'auto')
		}
	], [runNewChat, target]);

	// Tooltip strings
	const fixTooltip = target
		? localize('positronAssistantFixTargetTooltip', "Ask {0} to fix in new chat", target.label)
		: localize('positronAssistantFixTooltip', "Ask assistant to fix in new chat");
	const fixDropdownTooltip = localize('positronAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = target
		? localize('positronAssistantExplainTargetTooltip', "Ask {0} to explain in new chat", target.label)
		: localize('positronAssistantExplainTooltip', "Ask assistant to explain in new chat");
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
