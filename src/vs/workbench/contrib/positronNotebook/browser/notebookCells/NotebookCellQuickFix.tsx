/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellQuickFix.css';

// React.
import { useCallback, useMemo } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronConfiguration, useContextKeyFromString } from '../../../../../base/browser/positronReactHooks.js';
import { IAction } from '../../../../../base/common/actions.js';
import { removeAnsiEscapeCodes } from '../../../../../base/common/strings.js';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { CHAT_OPEN_ACTION_ID, ACTION_ID_NEW_CHAT } from '../../../chat/browser/actions/chatActions.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

const fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
const explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");

const NEW_CHAT_COMMAND = 'posit-assistant.newChat';
const ATTACHMENT_NAME = 'notebook-cell-error.txt';
const SIDEBAR_VIEW_SETTING = 'assistant.sidebarView';

/**
 * Props for the NotebookCellQuickFix component.
 */
interface NotebookCellQuickFixProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Quick fix component for notebook cell errors.
 * Displays "Fix" and "Explain" split buttons that send the error content to the assistant.
 * Uses posit-assistant.newChat when available, falling back to the built-in quick chat.
 * Primary click starts a fresh conversation; dropdown continues in the current conversation.
 */
export const NotebookCellQuickFix = (props: NotebookCellQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { commandService, contextMenuService, notificationService } = services;

	// Configuration hooks to conditionally show the quick-fix buttons
	const enableAssistant = usePositronConfiguration<boolean>('positron.assistant.enable');
	const enableNotebookMode = usePositronConfiguration<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
	const hasChatModels = useContextKeyFromString<boolean>('positron-assistant.hasChatModels');
	const sidebarViewEnabled = usePositronConfiguration<boolean>(SIDEBAR_VIEW_SETTING);

	// Only show buttons if assistant is enabled, notebook mode is enabled, and chat models are available
	const showQuickFix = enableAssistant && enableNotebookMode && hasChatModels;

	const cleanError = useMemo(
		() => removeAnsiEscapeCodes(props.errorContent).trim(),
		[props.errorContent]
	);

	const attachment = useMemo(() => {
		if (!cleanError) {
			return undefined;
		}
		const base64 = encodeBase64(VSBuffer.fromString(cleanError));
		return { uri: `data:text/plain;base64,${base64}`, name: ATTACHMENT_NAME };
	}, [cleanError]);

	const runNewChat = useCallback(async (prompt: string, target: 'new' | 'auto') => {
		try {
			await commandService.executeCommand(NEW_CHAT_COMMAND, {
				prompt,
				target,
				behavior: 'submit',
				...(attachment && { files: [attachment] }),
			});
		} catch {
			notificationService.error(
				localize(
					'positronNotebookAssistantUnavailable',
					"Posit Assistant is not available. Install the Posit Assistant extension to use Fix and Explain."
				)
			);
		}
	}, [commandService, notificationService, attachment]);

	const runQuickChat = useCallback((prompt: string, isNew: boolean) => {
		const query = cleanError
			? `${prompt}\n\`\`\`\n${cleanError}\n\`\`\``
			: prompt;
		if (isNew) {
			commandService.executeCommand(ACTION_ID_NEW_CHAT);
		}
		commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
			query,
			mode: ChatModeKind.Agent
		});
	}, [commandService, cleanError]);

	const pressedFixHandler = () => {
		if (sidebarViewEnabled) {
			return runNewChat(fixPrompt, 'new');
		}
		return runQuickChat(fixPrompt, true);
	};

	const pressedExplainHandler = () => {
		if (sidebarViewEnabled) {
			return runNewChat(explainPrompt, 'new');
		}
		return runQuickChat(explainPrompt, true);
	};

	// Memoize dropdown actions for Fix button
	const fixDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronNotebookAssistantFixInCurrentChat', "Ask assistant to fix in current chat"),
			tooltip: localize('positronNotebookAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => {
				if (sidebarViewEnabled) {
					return runNewChat(fixPrompt, 'auto');
				}
				return runQuickChat(fixPrompt, false);
			}
		}
	], [sidebarViewEnabled, runNewChat, runQuickChat]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronNotebookAssistantExplainInCurrentChat', "Ask assistant to explain in current chat"),
			tooltip: localize('positronNotebookAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => {
				if (sidebarViewEnabled) {
					return runNewChat(explainPrompt, 'auto');
				}
				return runQuickChat(explainPrompt, false);
			}
		}
	], [sidebarViewEnabled, runNewChat, runQuickChat]);

	// Don't render if assistant features are not enabled
	if (!showQuickFix) {
		return null;
	}

	// Tooltip strings
	const fixTooltip = localize('positronNotebookAssistantFixTooltip', "Ask assistant to fix in new chat");
	const fixDropdownTooltip = localize('positronNotebookAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronNotebookAssistantExplainTooltip', "Ask assistant to explain in new chat");
	const explainDropdownTooltip = localize('positronNotebookAssistantExplainDropdownTooltip', "More explain options");

	// Render.
	return (
		<div
			aria-label={localize('positron.notebook.quickFixGroup', "Cell output quick fix actions")}
			className='notebook-cell-quick-fix'
			role='group'
		>
			{/* Fix button with split dropdown */}
			<SplitButton
				ariaLabel={fixTooltip}
				className='notebook-cell-quick-fix-split-button'
				contextMenuService={contextMenuService}
				dropdownActions={fixDropdownActions}
				dropdownIconClass='codicon-positron-drop-down-arrow'
				dropdownTooltip={fixDropdownTooltip}
				onMainAction={pressedFixHandler}
			>
				<div className='link-text' title={fixTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronNotebookAssistantFix', "Fix")}
				</div>
			</SplitButton>

			{/* Explain button with split dropdown */}
			<SplitButton
				ariaLabel={explainTooltip}
				className='notebook-cell-quick-fix-split-button'
				contextMenuService={contextMenuService}
				dropdownActions={explainDropdownActions}
				dropdownIconClass='codicon-positron-drop-down-arrow'
				dropdownTooltip={explainDropdownTooltip}
				onMainAction={pressedExplainHandler}
			>
				<div className='link-text' title={explainTooltip}>
					<span className='codicon codicon-sparkle' />
					{localize('positronNotebookAssistantExplain', "Explain")}
				</div>
			</SplitButton>
		</div>
	);
};

