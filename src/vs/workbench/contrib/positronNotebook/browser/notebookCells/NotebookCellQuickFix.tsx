/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellQuickFix.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronConfiguration, usePositronContextKey } from '../../../../../base/browser/positronReactHooks.js';
import { IAction } from '../../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { removeAnsiEscapeCodes } from '../../../../../base/common/strings.js';
import { CHAT_OPEN_ACTION_ID, ACTION_ID_NEW_CHAT } from '../../../chat/browser/actions/chatActions.js';
import { ChatModeKind } from '../../../chat/common/constants.js';

/**
 * Props for the NotebookCellQuickFix component.
 */
interface NotebookCellQuickFixProps {
	/** The error output content from the cell execution */
	errorContent: string;
}

/**
 * Quick fix component for notebook cell errors.
 * Displays "Fix" and "Explain" split buttons that send the error content to the assistant chat.
 * Primary click starts a fresh chat session in agent mode (with tool access to modify notebooks),
 * dropdown opens in the existing chat panel to retain conversation context.
 *
 * @param props Component props containing the error content
 * @returns The rendered component, or null if assistant is not enabled
 */
export const NotebookCellQuickFix = (props: NotebookCellQuickFixProps) => {
	const fixDropdownRef = useRef<HTMLDivElement>(null);
	const explainDropdownRef = useRef<HTMLDivElement>(null);
	const services = usePositronReactServicesContext();
	const { commandService, contextMenuService } = services;

	// Configuration hooks to conditionally show the quick-fix buttons
	const enableAssistant = usePositronConfiguration<boolean>('positron.assistant.enable');
	const enableNotebookMode = usePositronConfiguration<boolean>('positron.assistant.notebookMode.enable');
	const hasChatModels = usePositronContextKey<boolean>('positron-assistant.hasChatModels');

	// Only show buttons if assistant is enabled, notebook mode is enabled, and chat models are available
	const showQuickFix = enableAssistant && enableNotebookMode && hasChatModels;

	/**
	 * Builds a query string for asking the assistant to fix the erroring cell.
	 * The assistant already has notebook context including the selected cell,
	 * so we only need to include the error output.
	 *
	 * @returns The formatted fix query string
	 */
	const buildFixQuery = (): string => {
		const cleanError = removeAnsiEscapeCodes(props.errorContent).trim();
		return cleanError
			? `Fix this cell that produced an error:\n\`\`\`\n${cleanError}\n\`\`\``
			: 'Fix this cell that produced an error.';
	};

	/**
	 * Builds a query string for asking the assistant to explain the error.
	 * The assistant already has notebook context including the selected cell,
	 * so we only need to include the error output.
	 *
	 * @returns The formatted explain query string
	 */
	const buildExplainQuery = (): string => {
		const cleanError = removeAnsiEscapeCodes(props.errorContent).trim();
		return cleanError
			? `Explain why this cell produced an error:\n\`\`\`\n${cleanError}\n\`\`\``
			: 'Explain why this cell produced an error.';
	};

	/**
	 * Handler for the "Fix" button primary click.
	 * Starts a fresh chat session and opens the chat panel in agent mode with a fix prompt and error output.
	 * Agent mode has tool access to modify notebooks.
	 */
	const pressedFixHandler = async () => {
		await commandService.executeCommand(ACTION_ID_NEW_CHAT);
		await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
			query: buildFixQuery(),
			mode: ChatModeKind.Agent
		});
	};

	/**
	 * Handler for the "Explain" button primary click.
	 * Starts a fresh chat session and opens the chat panel in agent mode with an explain prompt and error output.
	 * Agent mode has tool access to modify notebooks.
	 */
	const pressedExplainHandler = async () => {
		await commandService.executeCommand(ACTION_ID_NEW_CHAT);
		await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
			query: buildExplainQuery(),
			mode: ChatModeKind.Agent
		});
	};

	/**
	 * Shows the context menu for the Fix button dropdown.
	 * Provides option to open in the existing chat panel to retain conversation context.
	 *
	 * @param event Event from the dropdown button click or keyboard activation
	 */
	const showFixDropdownMenu = (event: React.SyntheticEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();

		const actions: IAction[] = [
			{
				id: 'continue-in-existing-chat',
				label: localize('positronNotebookAssistantFixInCurrentChat', "Ask assistant to fix in current chat"),
				tooltip: localize('positronNotebookAssistantFixInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
				class: undefined,
				enabled: true,
				run: async () => {
					await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
						query: buildFixQuery(),
						mode: ChatModeKind.Agent
					});
				}
			}
		];

		if (!fixDropdownRef.current) {
			return;
		}

		const rect = fixDropdownRef.current.getBoundingClientRect();
		contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x: rect.left, y: rect.bottom }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	/**
	 * Shows the context menu for the Explain button dropdown.
	 * Provides option to open in the existing chat panel to retain conversation context.
	 *
	 * @param event Event from the dropdown button click or keyboard activation
	 */
	const showExplainDropdownMenu = (event: React.SyntheticEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();

		const actions: IAction[] = [
			{
				id: 'continue-in-existing-chat',
				label: localize('positronNotebookAssistantExplainInCurrentChat', "Ask assistant to explain in current chat"),
				tooltip: localize('positronNotebookAssistantExplainInCurrentChatTooltip', "Opens in the current chat session to retain conversation context"),
				class: undefined,
				enabled: true,
				run: async () => {
					await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
						query: buildExplainQuery(),
						mode: ChatModeKind.Agent
					});
				}
			}
		];

		if (!explainDropdownRef.current) {
			return;
		}

		const rect = explainDropdownRef.current.getBoundingClientRect();
		contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x: rect.left, y: rect.bottom }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

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
		<div className='notebook-cell-quick-fix'>
			{/* Fix button with split dropdown */}
			<div className='notebook-cell-quick-fix-split-button'>
				<PositronButton
					ariaLabel={fixTooltip}
					className='assistant-action assistant-action-main'
					onPressed={pressedFixHandler}
				>
					<div className='link-text' title={fixTooltip}>
						<span className='codicon codicon-sparkle' />
						{localize('positronNotebookAssistantFix', "Fix")}
					</div>
				</PositronButton>
				<div
					ref={fixDropdownRef}
					aria-label={fixDropdownTooltip}
					className='assistant-action assistant-action-dropdown'
					role='button'
					tabIndex={0}
					title={fixDropdownTooltip}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							showFixDropdownMenu(e);
						}
					}}
					onMouseDown={showFixDropdownMenu}
				>
					<span className='codicon codicon-positron-drop-down-arrow' />
				</div>
			</div>

			{/* Explain button with split dropdown */}
			<div className='notebook-cell-quick-fix-split-button'>
				<PositronButton
					ariaLabel={explainTooltip}
					className='assistant-action assistant-action-main'
					onPressed={pressedExplainHandler}
				>
					<div className='link-text' title={explainTooltip}>
						<span className='codicon codicon-sparkle' />
						{localize('positronNotebookAssistantExplain', "Explain")}
					</div>
				</PositronButton>
				<div
					ref={explainDropdownRef}
					aria-label={explainDropdownTooltip}
					className='assistant-action assistant-action-dropdown'
					role='button'
					tabIndex={0}
					title={explainDropdownTooltip}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							showExplainDropdownMenu(e);
						}
					}}
					onMouseDown={showExplainDropdownMenu}
				>
					<span className='codicon codicon-positron-drop-down-arrow' />
				</div>
			</div>
		</div>
	);
};

