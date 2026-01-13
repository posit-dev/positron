/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useState, useRef, useCallback, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { ICommandService, CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

const MAX_CUSTOM_PROMPT_LENGTH = 15000;

/**
 * PredefinedAction interface.
 */
interface PredefinedAction {
	id: string;
	label: string;
	detail: string;
	query: string;
	mode: ChatModeKind;
	iconClass: string;
	generateSuggestions?: boolean;
}

/**
 * Predefined assistant actions.
 */
const PREDEFINED_ACTIONS: PredefinedAction[] = [
	{
		id: 'explain',
		label: localize('assistantPanel.action.explain', 'Explain this notebook'),
		detail: localize('assistantPanel.action.explain.detail', 'Summarize what this notebook does and how it works'),
		query: 'Explain this notebook: 1) Summarize the overall purpose and what it accomplishes, 2) Describe the key steps or workflow, 3) Highlight important code sections or techniques used, 4) Note any assumptions or prerequisites',
		mode: ChatModeKind.Ask,
		iconClass: 'codicon-book'
	},
	{
		id: 'fix',
		label: localize('assistantPanel.action.fix', 'Fix errors and issues'),
		detail: localize('assistantPanel.action.fix.detail', 'Debug problems and suggest improvements'),
		query: 'Fix issues in the notebook: 1) Identify and resolve any errors or warnings, 2) Explain what was wrong and why it occurred, 3) Suggest code quality improvements if applicable, 4) Provide corrected code following best practices',
		mode: ChatModeKind.Edit,
		iconClass: 'codicon-wrench'
	},
	{
		id: 'improve',
		label: localize('assistantPanel.action.improve', 'Improve this notebook'),
		detail: localize('assistantPanel.action.improve.detail', 'Add documentation and enhance readability'),
		query: 'Improve this notebook: 1) Add markdown documentation explaining what the notebook does, 2) Add comments to complex code sections, 3) Organize cells into logical sections, 4) Remove redundant code or cells, 5) Suggest structural improvements for clarity',
		mode: ChatModeKind.Edit,
		iconClass: 'codicon-edit'
	},
	{
		id: 'generate',
		label: localize('assistantPanel.action.generate', 'Generate AI suggestions...'),
		detail: localize('assistantPanel.action.generate.detail', 'Analyze notebook and suggest actions'),
		query: '',
		mode: ChatModeKind.Agent,
		iconClass: 'codicon-sparkle',
		generateSuggestions: true
	}
];

/**
 * AISuggestion interface.
 */
interface AISuggestion {
	label: string;
	query: string;
	mode: ChatModeKind;
}

/**
 * AssistantPanelActionsProps interface.
 */
export interface AssistantPanelActionsProps {
	notebook: IPositronNotebookInstance;
	commandService: ICommandService;
	notificationService: INotificationService;
	logService: ILogService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
	onClose: () => void;
}

/**
 * AssistantPanelActions component.
 * Displays custom prompt input and predefined action buttons.
 */
export const AssistantPanelActions = (props: AssistantPanelActionsProps) => {
	const { notebook, commandService, notificationService, logService, onActionSelected } = props;

	const [customPrompt, setCustomPrompt] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
	const cancellationTokenSourceRef = useRef<CancellationTokenSource | null>(null);
	const suggestionsContainerRef = useRef<HTMLDivElement>(null);
	const userHasScrolledRef = useRef(false);

	const handleCustomPromptSubmit = useCallback(() => {
		const trimmed = customPrompt.trim();
		if (!trimmed) {
			return;
		}

		if (trimmed.length > MAX_CUSTOM_PROMPT_LENGTH) {
			notificationService.error(
				localize(
					'assistantPanel.prompt.tooLong',
					'Prompt is too long. Maximum length is {0} characters.',
					MAX_CUSTOM_PROMPT_LENGTH
				)
			);
			return;
		}

		onActionSelected(trimmed, ChatModeKind.Agent);
	}, [customPrompt, notificationService, onActionSelected]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleCustomPromptSubmit();
		}
	}, [handleCustomPromptSubmit]);

	const handleGenerateSuggestions = useCallback(async () => {
		if (isGenerating) {
			return;
		}

		setIsGenerating(true);
		setAiSuggestions([]);

		const cancellationTokenSource = new CancellationTokenSource();
		cancellationTokenSourceRef.current = cancellationTokenSource;

		try {
			const callbackCommandId = `positron-notebook-suggestions-callback-${generateUuid()}`;
			const progressiveSuggestions: AISuggestion[] = [];

			const callbackDisposable = CommandsRegistry.registerCommand(
				callbackCommandId,
				(_accessor, suggestion: { label: string; query: string; mode: ChatModeKind }) => {
					progressiveSuggestions.push(suggestion);
					setAiSuggestions([...progressiveSuggestions]);
				}
			);

			try {
				const result = await commandService.executeCommand<{
					suggestions: AISuggestion[];
					rawResponseText?: string;
				}>(
					'positron-assistant.generateNotebookSuggestions',
					notebook.uri.toString(),
					callbackCommandId,
					cancellationTokenSource.token
				);

				callbackDisposable.dispose();

				if (cancellationTokenSource.token.isCancellationRequested) {
					return;
				}

				const suggestions = result?.suggestions || [];
				if (suggestions.length === 0) {
					if (result?.rawResponseText) {
						logService.warn('[AssistantPanel] No suggestions generated. Raw LLM response:', result.rawResponseText);
					}
					notificationService.info(
						localize(
							'assistantPanel.noSuggestions',
							'No suggestions generated. Try selecting cells or executing code first.'
						)
					);
				}

				setAiSuggestions(suggestions);
			} finally {
				callbackDisposable.dispose();
			}
		} catch (error) {
			if (!isCancellationError(error)) {
				notificationService.error(
					localize(
						'assistantPanel.generateError',
						'Failed to generate suggestions: {0}',
						error instanceof Error ? error.message : String(error)
					)
				);
			}
		} finally {
			setIsGenerating(false);
			cancellationTokenSourceRef.current = null;
		}
	}, [isGenerating, notebook, commandService, notificationService, logService]);

	const handleActionClick = useCallback(async (action: PredefinedAction) => {
		if (action.generateSuggestions) {
			await handleGenerateSuggestions();
		} else {
			onActionSelected(action.query, action.mode);
		}
	}, [handleGenerateSuggestions, onActionSelected]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			cancellationTokenSourceRef.current?.cancel();
			cancellationTokenSourceRef.current?.dispose();
		};
	}, []);

	// Track if user has manually scrolled
	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		const element = e.currentTarget;
		const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50;
		userHasScrolledRef.current = !isAtBottom;
	}, []);

	// Auto-scroll when new suggestions arrive
	useEffect(() => {
		if (aiSuggestions.length > 0 && !userHasScrolledRef.current && suggestionsContainerRef.current) {
			suggestionsContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}
	}, [aiSuggestions]);

	// Reset scroll tracking when generation starts
	useEffect(() => {
		if (isGenerating) {
			userHasScrolledRef.current = false;
		}
	}, [isGenerating]);

	return (
		<div className='assistant-panel-section'>
			<div className='assistant-panel-section-header'>
				{localize('assistantPanel.actions.header', 'Actions')}
			</div>
			<div className='assistant-panel-section-content'>
				{/* Custom prompt input with submit button */}
				<div className={positronClassNames(
					'assistant-panel-prompt-wrapper',
					{ 'has-content': customPrompt.trim().length > 0 }
				)}>
					<textarea
						autoFocus
						className='assistant-panel-prompt-input'
						placeholder={localize('assistantPanel.prompt.placeholder', 'Ask assistant to...')}
						rows={1}
						value={customPrompt}
						onChange={(e) => setCustomPrompt(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					<button
						aria-label={localize('assistantPanel.submit', 'Submit prompt')}
						className='assistant-panel-submit-button'
						tabIndex={customPrompt.trim().length > 0 ? 0 : -1}
						title={localize('assistantPanel.submit', 'Submit prompt')}
						onClick={handleCustomPromptSubmit}
					>
						<span className='codicon codicon-arrow-right' />
					</button>
				</div>

				{/* Pre-built actions label */}
				<div className='assistant-panel-prebuilt-label'>
					{localize('assistantPanel.prebuilt', 'Pre-built')}
				</div>

				{/* Predefined actions */}
				{PREDEFINED_ACTIONS.map((action) => (
					<div
						key={action.id}
						className={positronClassNames(
							'assistant-panel-action',
							{ 'loading': action.generateSuggestions && isGenerating },
							{ 'dynamic-action': action.generateSuggestions }
						)}
						role='button'
						tabIndex={0}
						onClick={() => handleActionClick(action)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleActionClick(action);
							}
						}}
					>
						<span className={`assistant-panel-action-icon codicon ${action.iconClass}`} />
						<div className='assistant-panel-action-content'>
							<div className='assistant-panel-action-label'>{action.label}</div>
							<div className='assistant-panel-action-detail'>{action.detail}</div>
						</div>
					</div>
				))}

				{/* AI-generated suggestions */}
				{aiSuggestions.length > 0 && (
					<div
						ref={suggestionsContainerRef}
						className='assistant-panel-ai-suggestions-container'
						onScroll={handleScroll}
					>
						<div className='assistant-panel-ai-suggestions-header'>
							{localize('assistantPanel.aiSuggestions', 'AI-Generated Suggestions')}
						</div>
						{aiSuggestions.map((suggestion, index) => (
							<div
								key={index}
								className='assistant-panel-action'
								role='button'
								tabIndex={0}
								onClick={() => onActionSelected(suggestion.query, suggestion.mode)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onActionSelected(suggestion.query, suggestion.mode);
									}
								}}
							>
								<span className='assistant-panel-action-icon codicon codicon-sparkle' />
								<div className='assistant-panel-action-content'>
									<div className='assistant-panel-action-label'>{suggestion.label}</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
