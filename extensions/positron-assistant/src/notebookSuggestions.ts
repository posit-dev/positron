/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';

import { ParticipantService } from './participants.js';
import { isFileExcludedFromAI } from './fileExclusion.js';
import { MARKDOWN_DIR } from './constants';
import { serializeNotebookContext } from './tools/notebookUtils.js';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { selectPreferredModel } from './modelSelection.js';

/**
 * Interface for notebook action suggestions returned to the workbench
 */
export interface NotebookActionSuggestion {
	label: string;
	detail?: string;
	query: string;
	mode: 'ask' | 'edit' | 'agent';
	iconClass?: string;
}

/**
 * Result object containing suggestions and raw response text for debugging.
 * rawResponseText is only populated when no suggestions were parsed (for debugging).
 */
export interface NotebookSuggestionsResult {
	suggestions: NotebookActionSuggestion[];
	/** Raw LLM response text, only included when suggestions array is empty (for debugging) */
	rawResponseText?: string;
}

/**
 * Valid XML tag names for parsing suggestions
 */
type SuggestionTag = 'suggestions' | 'suggestion' | 'label' | 'detail' | 'query' | 'mode' | 'iconClass';


/**
 * Generate AI-powered action suggestions based on notebook context
 * @param notebookUri URI of the notebook to analyze
 * @param participantService Service for accessing the current chat model
 * @param log Log output channel for debugging
 * @param token Cancellation token
 * @param progressCallbackCommand Optional command ID to call for progress updates (enables progressive display)
 * @returns Result object containing suggestions and raw response text
 */
export async function generateNotebookSuggestions(
	notebookUri: string,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
	progressCallbackCommand?: string
): Promise<NotebookSuggestionsResult> {
	// Check if notebook is excluded from AI features
	if (isFileExcludedFromAI(vscode.Uri.parse(notebookUri))) {
		log.debug('[notebook-suggestions] Notebook excluded from AI features by aiExcludes setting');
		return { suggestions: [] };
	}

	// Get the model to use for generation
	const model = await getModel(participantService, log);

	// Get notebook context
	const context = await positron.notebooks.getContext();
	if (!context) {
		log.warn('[notebook-suggestions] No notebook context available');
		return { suggestions: [] };
	}

	// Get all cells if not already included in context
	const allCells = context.allCells || await positron.notebooks.getCells(notebookUri);

	// Ensure context has allCells populated for serialization
	const contextWithAllCells = {
		...context,
		allCells
	};

	// Build serialized context
	const serialized = serializeNotebookContext(contextWithAllCells, { wrapInNotebookContext: true });
	const contextSummary = serialized.fullContext || '';

	// Load the system prompt template
	const systemPrompt = await fs.promises.readFile(
		path.join(MARKDOWN_DIR, 'prompts', 'notebook', 'suggestions.md'),
		'utf8'
	);

	try {
		// Construct messages for the request
		const systemMessage = new vscode.LanguageModelChatMessage(
			vscode.LanguageModelChatMessageRole.System,
			systemPrompt
		);
		const userMessage = vscode.LanguageModelChatMessage.User(contextSummary);

		// Send request to LLM
		const response = await model.sendRequest([
			systemMessage,
			userMessage
		], {}, token);

		// Parse XML response as it streams and collect raw text
		const parseResult = await parseStreamingXML(response.text, log, token, progressCallbackCommand);

		// Only include rawResponseText when no suggestions were parsed (for debugging)
		return {
			suggestions: parseResult.suggestions,
			rawResponseText: parseResult.suggestions.length === 0 ? parseResult.rawResponseText : undefined
		};

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`[notebook-suggestions] Error generating suggestions: ${errorMessage}`);

		// Return empty result rather than throwing to allow graceful degradation
		vscode.window.showWarningMessage(
			`Failed to generate AI suggestions: ${errorMessage}. Please try again or use predefined actions.`
		);
		return { suggestions: [] };
	}
}

/**
 * Parse streaming XML response and build suggestions progressively
 */
async function parseStreamingXML(
	textStream: AsyncIterable<string>,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
	progressCallbackCommand?: string
): Promise<{ suggestions: NotebookActionSuggestion[]; rawResponseText: string }> {
	const suggestions: NotebookActionSuggestion[] = [];
	let currentSuggestion: Partial<NotebookActionSuggestion> | null = null;
	let currentField: keyof NotebookActionSuggestion | null = null;
	let currentFieldContent = '';
	let rawResponseText = '';

	// Create streaming tag lexer
	const lexer = new StreamingTagLexer<SuggestionTag>({
		tagNames: ['suggestions', 'suggestion', 'label', 'detail', 'query', 'mode', 'iconClass'],
		contentHandler: async (chunk) => {
			if (chunk.type === 'tag') {
				if (chunk.name === 'suggestion') {
					if (chunk.kind === 'open') {
						// Start a new suggestion
						// Reset any open field state from previous suggestion (handles malformed XML)
						if (currentField) {
							log.warn(`[notebook-suggestions] New suggestion opened while field '${currentField}' was still open, resetting field state`);
							currentField = null;
							currentFieldContent = '';
						}
						currentSuggestion = {};
					} else if (chunk.kind === 'close' && currentSuggestion) {
						// Save any pending field content before completing the suggestion
						// This handles cases where a field tag was opened but never properly closed
						if (currentField && currentFieldContent.trim()) {
							currentSuggestion[currentField] = currentFieldContent.trim() as NotebookActionSuggestion['mode'];
							currentField = null;
							currentFieldContent = '';
						}

						// Complete the suggestion and add to results
						const completed = completeSuggestion(currentSuggestion, log);
						if (completed) {
							suggestions.push(completed);
							log.debug(`[notebook-suggestions] Completed suggestion: ${completed.label}`);

							// Call progress callback command if provided
							if (progressCallbackCommand) {
								try {
									await vscode.commands.executeCommand(progressCallbackCommand, completed);
								} catch (error) {
									// Log but don't fail if callback fails
									log.warn(`[notebook-suggestions] Progress callback failed: ${error}`);
								}
							}
						}
						currentSuggestion = null;
					}
				} else if (chunk.name === 'label' || chunk.name === 'detail' ||
					chunk.name === 'query' || chunk.name === 'mode' ||
					chunk.name === 'iconClass') {
					if (chunk.kind === 'open') {
						// Start collecting content for this field
						currentField = chunk.name;
						currentFieldContent = '';
					} else if (chunk.kind === 'close' && currentField && currentSuggestion) {
						// Save the field content
						currentSuggestion[currentField] = currentFieldContent.trim() as NotebookActionSuggestion['mode'];
						currentField = null;
						currentFieldContent = '';
					}
				}
			} else {
				// Accumulate text content for the current field
				if (currentField) {
					currentFieldContent += chunk.text;
				}
			}
		}
	});

	// Stream the response through the lexer
	try {
		for await (const delta of textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			// Collect raw response text for debugging
			rawResponseText += delta;
			await lexer.process(delta);
		}

		// Flush any remaining content
		await lexer.flush();
	} catch (error) {
		log.error(`[notebook-suggestions] Error during XML streaming: ${error}`);
		// Re-throw to propagate to outer handler
		throw error;
	}

	// Limit to 5 suggestions
	return {
		suggestions: suggestions.slice(0, 5),
		rawResponseText
	};
}

/**
 * Complete and validate a partial suggestion
 */
function completeSuggestion(
	partial: Partial<NotebookActionSuggestion>,
	log: vscode.LogOutputChannel
): NotebookActionSuggestion | null {
	// Validate required fields
	if (!partial.label || !partial.query) {
		log.warn('[notebook-suggestions] Invalid suggestion: missing label or query');
		return null;
	}

	// Normalize mode to valid values
	let mode: 'ask' | 'edit' | 'agent' = 'agent';
	if (partial.mode === 'ask' || partial.mode === 'edit' || partial.mode === 'agent') {
		mode = partial.mode;
	}

	return {
		label: partial.label,
		detail: partial.detail,
		query: partial.query,
		mode,
		iconClass: partial.iconClass
	};
}

/**
 * Get the language model to use for generation
 * Follows the same pattern as git.ts
 * @param participantService Service for accessing the current chat model
 * @param log Log output channel for debugging
 * @returns The selected language model
 */
async function getModel(participantService: ParticipantService, log: vscode.LogOutputChannel): Promise<vscode.LanguageModelChat> {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const configuredPatterns = config.get<string[]>('notebookSuggestions.model') || [];
	const selection = await selectPreferredModel({
		participantService,
		log,
		logPrefix: 'notebook-suggestions',
		configuredModels: {
			patterns: configuredPatterns,
			matchMode: 'partial',
		},
	});
	if (!selection) {
		throw new Error('No language model available');
	}

	return selection.model;
}
