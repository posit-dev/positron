/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useState, useRef, useCallback, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { useContextKey, usePositronConfiguration } from '../../../../../base/browser/positronReactHooks.js';
import { isFileExcludedFromAI } from '../../../chat/browser/tools/utils.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { IHeadlessLanguageModelService } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { generateSuggestions, INotebookSuggestion, ISuggestionsRequest } from './notebookSuggestions.js';
import { NOTEBOOK_SUGGESTIONS_MODEL_KEY } from './notebookSuggestionsConfig.js';
import { TwinklingSparkleIcon } from './TwinklingSparkleIcon.js';

const MAX_CUSTOM_PROMPT_LENGTH = 15000;

/**
 * Bound the whole generation: a stalling model (no deltas, no error -- e.g. a
 * fast/cheap-tier model the gateway lists but can't stream) must not leave the
 * panel generating forever. Matches the ghost-cell and visualize 30s cap.
 */
const GENERATE_SUGGESTIONS_TIMEOUT_MS = 30_000;

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
}

/**
 * The kind of document the panel acts on. Notebooks are Positron notebooks;
 * documents are text documents such as Quarto files.
 */
export type AssistantPanelDocumentKind = 'notebook' | 'document';

/**
 * Predefined assistant actions for each document kind.
 */
const PREDEFINED_ACTIONS: Record<AssistantPanelDocumentKind, PredefinedAction[]> = {
	notebook: [
		{
			id: 'explain',
			label: localize('assistantPanel.action.explain', 'Explain This Notebook'),
			detail: localize('assistantPanel.action.explain.detail', 'Summarize what this notebook does and how it works'),
			query: 'Explain this notebook: 1) Summarize the overall purpose and what it accomplishes, 2) Describe the key steps or workflow, 3) Highlight important code sections or techniques used, 4) Note any assumptions or prerequisites',
			mode: ChatModeKind.Ask,
			iconClass: 'codicon-book'
		},
		{
			id: 'fix',
			label: localize('assistantPanel.action.fix', 'Fix Errors and Issues'),
			detail: localize('assistantPanel.action.fix.detail', 'Debug problems and suggest improvements'),
			query: 'Fix issues in the notebook: 1) Identify and resolve any errors or warnings, 2) Explain what was wrong and why it occurred, 3) Suggest code quality improvements if applicable, 4) Provide corrected code following best practices',
			mode: ChatModeKind.Edit,
			iconClass: 'codicon-wrench'
		},
		{
			id: 'improve',
			label: localize('assistantPanel.action.improve', 'Improve This Notebook'),
			detail: localize('assistantPanel.action.improve.detail', 'Add documentation and enhance readability'),
			query: 'Improve this notebook: 1) Add markdown documentation explaining what the notebook does, 2) Add comments to complex code sections, 3) Organize cells into logical sections, 4) Remove redundant code or cells, 5) Suggest structural improvements for clarity',
			mode: ChatModeKind.Edit,
			iconClass: 'codicon-edit'
		}
	],
	document: [
		{
			id: 'explain',
			label: localize('assistantPanel.action.explainDocument', 'Explain This Document'),
			detail: localize('assistantPanel.action.explainDocument.detail', 'Summarize what this document does and how it works'),
			query: 'Explain this document: 1) Summarize the overall purpose and what it accomplishes, 2) Describe the key steps or workflow, 3) Highlight important code chunks or techniques used, 4) Note any assumptions or prerequisites',
			mode: ChatModeKind.Ask,
			iconClass: 'codicon-book'
		},
		{
			id: 'fix',
			label: localize('assistantPanel.action.fix', 'Fix Errors and Issues'),
			detail: localize('assistantPanel.action.fix.detail', 'Debug problems and suggest improvements'),
			query: 'Fix issues in the document: 1) Identify and resolve any errors or warnings, 2) Explain what was wrong and why it occurred, 3) Suggest code quality improvements if applicable, 4) Provide corrected code following best practices',
			mode: ChatModeKind.Edit,
			iconClass: 'codicon-wrench'
		},
		{
			id: 'improve',
			label: localize('assistantPanel.action.improveDocument', 'Improve This Document'),
			detail: localize('assistantPanel.action.improveDocument.detail', 'Add documentation and enhance readability'),
			query: 'Improve this document: 1) Add prose explaining what the document does, 2) Add comments to complex code chunks, 3) Organize content into logical sections with headings, 4) Remove redundant code or chunks, 5) Suggest structural improvements for clarity',
			mode: ChatModeKind.Edit,
			iconClass: 'codicon-edit'
		}
	]
};

/**
 * Strings that mention the document kind.
 */
const KIND_STRINGS: Record<AssistantPanelDocumentKind, { noSuggestions: string; generatingDetail: string; generateDetail: string }> = {
	notebook: {
		noSuggestions: localize('assistantPanel.noSuggestions', 'No suggestions available. The assistant couldn\'t identify specific actions for this notebook. Try using the pre-built actions above or enter a custom prompt.'),
		generatingDetail: localize('assistantPanel.action.generating.detail', 'Suggestions based on notebook content'),
		generateDetail: localize('assistantPanel.action.generate.detail', 'Analyze notebook and suggest actions'),
	},
	document: {
		noSuggestions: localize('assistantPanel.noSuggestionsDocument', 'No suggestions available. The assistant couldn\'t identify specific actions for this document. Try using the pre-built actions above or enter a custom prompt.'),
		generatingDetail: localize('assistantPanel.action.generatingDocument.detail', 'Suggestions based on document content'),
		generateDetail: localize('assistantPanel.action.generateDocument.detail', 'Analyze document and suggest actions'),
	},
};

/**
 * AssistantPanelActionsProps interface.
 */
export interface AssistantPanelActionsProps {
	kind: AssistantPanelDocumentKind;
	uri: URI;
	configurationService: IConfigurationService;
	headlessLmService: IHeadlessLanguageModelService;
	/** The request used to generate suggestions; undefined while the document context is loading */
	suggestionsRequest: ISuggestionsRequest | undefined;
	notificationService: INotificationService;
	onActionSelected: (query: string, mode: ChatModeKind) => void;
	onClose: () => void;
}

/**
 * AssistantPanelActions component.
 * Displays custom prompt input and predefined action buttons.
 */
export const AssistantPanelActions = (props: AssistantPanelActionsProps) => {
	const { kind, uri, configurationService, headlessLmService, suggestionsRequest, notificationService, onActionSelected } = props;
	const strings = KIND_STRINGS[kind];

	// Notebooks use the composite notebook AI gate (global ai.enabled AND
	// notebook.ai.enabled), kept in sync by bindNotebookAIEnabledContextKey; other
	// documents use ai.enabled alone. Read reactively so toggling either without a
	// window reload updates the gate. undefined reads as enabled.
	const notebookAiEnabled = useContextKey<boolean>(NotebookContextKeys.aiEnabled);
	const globalAiEnabled = usePositronConfiguration<boolean | undefined>(AI_ENABLED_KEY);

	const [customPrompt, setCustomPrompt] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [aiSuggestions, setAiSuggestions] = useState<INotebookSuggestion[]>([]);
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

		const notifyNoSuggestions = () => notificationService.info(strings.noSuggestions);

		// Honor the AI gate and the per-file exclusion the user configured: never
		// send a document to a model when AI is disabled or the file is excluded.
		// Both gates default to enabled, so only an explicit disable blocks generation.
		const aiEnabled = (kind === 'notebook' ? notebookAiEnabled : globalAiEnabled) !== false;
		if (!suggestionsRequest || !aiEnabled || isFileExcludedFromAI(configurationService, uri.path)) {
			notifyNoSuggestions();
			return;
		}

		setIsGenerating(true);
		setAiSuggestions([]);

		const cancellationTokenSource = new CancellationTokenSource();
		cancellationTokenSourceRef.current = cancellationTokenSource;

		// Cancel the request if the model stalls, so the panel fails visibly
		// instead of spinning forever. Any suggestions that already streamed in
		// are kept (they were reported via setAiSuggestions).
		let timedOut = false;
		const timeoutHandle = setTimeout(() => {
			timedOut = true;
			cancellationTokenSource.cancel();
		}, GENERATE_SUGGESTIONS_TIMEOUT_MS);

		try {
			const modelSetting = configurationService.getValue<string[]>(NOTEBOOK_SUGGESTIONS_MODEL_KEY);
			const suggestions = await generateSuggestions(
				headlessLmService,
				suggestionsRequest,
				modelSetting,
				cancellationTokenSource.token,
				setAiSuggestions,
			);

			if (cancellationTokenSource.token.isCancellationRequested) {
				// A timeout with nothing to show is a silent stall; tell the user.
				// A user-initiated cancel (regenerate / close) stays silent.
				if (timedOut && suggestions.length === 0) {
					notifyNoSuggestions();
				}
				return;
			}

			if (suggestions.length === 0) {
				notifyNoSuggestions();
			}

			setAiSuggestions(suggestions);
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
			clearTimeout(timeoutHandle);
			cancellationTokenSource.dispose();
			setIsGenerating(false);
			cancellationTokenSourceRef.current = null;
		}
	}, [isGenerating, kind, uri, suggestionsRequest, strings, notebookAiEnabled, globalAiEnabled, configurationService, headlessLmService, notificationService]);

	const handleActionClick = useCallback((action: PredefinedAction) => {
		onActionSelected(action.query, action.mode);
	}, [onActionSelected]);

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
		// Track if user has scrolled away from bottom to prevent auto-scroll interruption
		// When true, user has manually scrolled up and we should not auto-scroll
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
			<div className='assistant-panel-section-content'>
				{/* Predefined actions */}
				{PREDEFINED_ACTIONS[kind].map((action) => (
					<button
						key={action.id}
						className='assistant-panel-action'
						onClick={() => handleActionClick(action)}
					>
						<span className={`assistant-panel-action-icon codicon ${action.iconClass}`} />
						<div className='assistant-panel-action-content'>
							<div className='assistant-panel-action-label'>{action.label}</div>
							<div className='assistant-panel-action-detail'>{action.detail}</div>
						</div>
					</button>
				))}

				{/* Custom prompt input with submit button */}
				<div className={positronClassNames(
					'assistant-panel-prompt-wrapper',
					{ 'has-content': customPrompt.trim().length > 0 }
				)}>
					<textarea
						className='assistant-panel-prompt-input'
						placeholder={localize('assistantPanel.prompt.placeholder', 'Or enter a custom prompt')}
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
						<span className='assistant-panel-submit-icon codicon codicon-send' />
					</button>
				</div>

				<div className='assistant-panel-action-divider' />

				{/* Generate AI Suggestions button / AI Suggestions header */}
				<button
					className={positronClassNames(
						'assistant-panel-suggestions-button',
						{ 'generating': isGenerating },
						{ 'has-suggestions': aiSuggestions.length > 0 }
					)}
					disabled={isGenerating}
					onClick={handleGenerateSuggestions}
				>
					<div className='suggestions-button-content'>
						<div className='suggestions-button-label'>
							{isGenerating
								? localize('assistantPanel.generating', 'Generating suggestions...')
								: aiSuggestions.length > 0
									? localize('assistantPanel.aiSuggestions', 'AI Suggestions')
									: localize('assistantPanel.action.generate', 'Generate AI Suggestions')}
						</div>
						<div className='suggestions-button-detail'>
							{isGenerating
								? strings.generatingDetail
								: aiSuggestions.length > 0
									? localize('assistantPanel.action.regenerate.detail', 'Click to regenerate suggestions')
									: strings.generateDetail}
						</div>
					</div>
					<TwinklingSparkleIcon animating={isGenerating} />
				</button>

				{/* AI-generated suggestions */}
				{aiSuggestions.length > 0 && (
					<div
						ref={suggestionsContainerRef}
						className='assistant-panel-suggestions-list'
						onScroll={handleScroll}
					>
						{aiSuggestions.map((suggestion, index) => (
							<button
								key={index}
								className='assistant-panel-action'
								onClick={() => onActionSelected(suggestion.query, suggestion.mode)}
							>
								<span className='assistant-panel-action-icon codicon codicon-sparkle' />
								<div className='assistant-panel-action-content'>
									<div className='assistant-panel-action-label'>{suggestion.label}</div>
								</div>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
