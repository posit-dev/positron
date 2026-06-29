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
import { NOTEBOOK_AI_ENABLED_KEY, POSITRON_NOTEBOOK_ENABLED_KEY } from '../../common/positronNotebookConfig.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { openPositAssistantChat } from '../../../positronAssistant/browser/positAssistantChat.js';
import { SplitButton } from '../utilityComponents/SplitButton.js';

const fixPrompt = localize('positronNotebookAssistantFixPrompt', "Fix this notebook cell error.");
const explainPrompt = localize('positronNotebookAssistantExplainPrompt', "Explain this notebook cell error.");

const ATTACHMENT_NAME = 'notebook-cell-error.txt';

/**
 * Props for the NotebookCellQuickFix component.
 */
interface NotebookCellQuickFixProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Quick fix component for notebook cell errors.
 * Displays "Fix" and "Explain" split buttons that send the error content to the assistant
 * via posit-assistant.newChat.
 * Primary click starts a fresh conversation; dropdown continues in the current conversation.
 */
export const NotebookCellQuickFix = (props: NotebookCellQuickFixProps) => {
	const services = usePositronReactServicesContext();
	const { commandService, contextMenuService, logService, notificationService } = services;

	// Configuration hooks to conditionally show the quick-fix buttons
	const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
	// notebook.ai.enabled defaults to true, so only an explicit `false` hides the buttons.
	const notebookAiEnabled = usePositronConfiguration<boolean>(NOTEBOOK_AI_ENABLED_KEY);
	const enableNotebookMode = usePositronConfiguration<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
	// Set by the Posit Assistant extension when it has at least one usable model.
	// The old positron-assistant.hasChatModels key is going away this milestone.
	const hasChatModels = useContextKeyFromString<boolean>('posit-assistant.hasChatModels');

	// Only show buttons if AI is enabled (global + notebooks), notebook mode is
	// enabled, and chat models are available
	const showQuickFix = aiEnabled && notebookAiEnabled !== false && enableNotebookMode && hasChatModels;

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

	const runNewChat = useCallback((prompt: string, target: 'new' | 'auto') =>
		openPositAssistantChat(commandService, notificationService, logService, {
			prompt,
			target,
			behavior: 'submit',
			...(attachment && { files: [attachment] }),
		}),
		[commandService, logService, notificationService, attachment]);

	const pressedFixHandler = () => runNewChat(fixPrompt, 'new');

	const pressedExplainHandler = () => runNewChat(explainPrompt, 'new');

	// Memoize dropdown actions for Fix button
	const fixDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronNotebookAssistantFixInCurrentChat', "Ask assistant to fix in current chat"),
			tooltip: localize('positronNotebookAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runNewChat(fixPrompt, 'auto')
		}
	], [runNewChat]);

	// Memoize dropdown actions for Explain button
	const explainDropdownActions = useMemo((): IAction[] => [
		{
			id: 'continue-in-existing-chat',
			label: localize('positronNotebookAssistantExplainInCurrentChat', "Ask assistant to explain in current chat"),
			tooltip: localize('positronNotebookAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
			class: undefined,
			enabled: true,
			run: () => runNewChat(explainPrompt, 'auto')
		}
	], [runNewChat]);

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

