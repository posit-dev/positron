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
import { CHAT_OPEN_ACTION_ID } from '../../../chat/browser/actions/chatActions.js';

const fixPrompt = '/fix';
const explainPrompt = '/explain';

interface NotebookCellQuickFixProps {
	errorContent: string;
}

/**
 * Quick fix component for notebook cell errors.
 * Displays "Fix" and "Explain" split buttons that send the error content to the assistant chat.
 * Primary click opens quick chat, dropdown opens main chat panel to retain conversation context.
 *
 * @param props Component props containing the error content
 * @returns The rendered component, or null if assistant is not enabled
 */
export const NotebookCellQuickFix = (props: NotebookCellQuickFixProps) => {
	const fixButtonRef = useRef<HTMLDivElement>(undefined!);
	const explainButtonRef = useRef<HTMLDivElement>(undefined!);
	const fixDropdownRef = useRef<HTMLDivElement>(undefined!);
	const explainDropdownRef = useRef<HTMLDivElement>(undefined!);
	const services = usePositronReactServicesContext();
	const { quickChatService, commandService, contextMenuService } = services;

	// Configuration hooks to conditionally show the quick-fix buttons
	const enableAssistant = usePositronConfiguration<boolean>('positron.assistant.enable');
	const enableNotebookMode = usePositronConfiguration<boolean>('positron.assistant.notebookMode.enable');
	const hasChatModels = usePositronContextKey<boolean>('positron-assistant.hasChatModels');

	// Only show buttons if assistant is enabled, notebook mode is enabled, and chat models are available
	const showQuickFix = enableAssistant && enableNotebookMode && hasChatModels;

	/**
	 * Builds the query string with prompt and error content in a code block.
	 *
	 * @param prompt The prompt prefix (/fix or /explain)
	 * @returns The formatted query string
	 */
	const buildQuery = (prompt: string): string => {
		return props.errorContent ? `${prompt}\n\`\`\`\n${props.errorContent}\n\`\`\`` : prompt;
	};

	/**
	 * Handler for the "Fix" button primary click.
	 * Opens the quick chat with a fix prompt and the error content in a code block.
	 */
	const pressedFixHandler = async () => {
		quickChatService.open({
			query: buildQuery(fixPrompt)
		});
	};

	/**
	 * Handler for the "Explain" button primary click.
	 * Opens the quick chat with an explain prompt and the error content in a code block.
	 */
	const pressedExplainHandler = async () => {
		quickChatService.open({
			query: buildQuery(explainPrompt)
		});
	};

	/**
	 * Shows the context menu for the Fix button dropdown.
	 * Provides option to open in main chat panel instead of quick chat.
	 *
	 * @param event Mouse event from the dropdown button click
	 */
	const showFixDropdownMenu = (event: React.MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();

		const actions: IAction[] = [
			{
				id: 'open-in-chat-panel',
				label: localize('positronNotebookAssistantOpenInChatPanel', "Open in Chat Panel"),
				tooltip: localize('positronNotebookAssistantOpenInChatPanelTooltip', "Open in main chat panel to retain conversation context"),
				class: undefined,
				enabled: true,
				run: async () => {
					await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
						query: buildQuery(fixPrompt)
					});
				}
			}
		];

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
	 * Provides option to open in main chat panel instead of quick chat.
	 *
	 * @param event Mouse event from the dropdown button click
	 */
	const showExplainDropdownMenu = (event: React.MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();

		const actions: IAction[] = [
			{
				id: 'open-in-chat-panel',
				label: localize('positronNotebookAssistantOpenInChatPanel', "Open in Chat Panel"),
				tooltip: localize('positronNotebookAssistantOpenInChatPanelTooltip', "Open in main chat panel to retain conversation context"),
				class: undefined,
				enabled: true,
				run: async () => {
					await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
						query: buildQuery(explainPrompt)
					});
				}
			}
		];

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
	const fixTooltip = localize('positronNotebookAssistantFixTooltip', "Ask the assistant to fix this error");
	const fixDropdownTooltip = localize('positronNotebookAssistantFixDropdownTooltip', "More fix options");
	const explainTooltip = localize('positronNotebookAssistantExplainTooltip', "Ask the assistant to explain this error");
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
					<div ref={fixButtonRef} className='link-text' title={fixTooltip}>
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
							e.preventDefault();
							showFixDropdownMenu(e as unknown as React.MouseEvent<HTMLDivElement>);
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
					<div ref={explainButtonRef} className='link-text' title={explainTooltip}>
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
							e.preventDefault();
							showExplainDropdownMenu(e as unknown as React.MouseEvent<HTMLDivElement>);
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

