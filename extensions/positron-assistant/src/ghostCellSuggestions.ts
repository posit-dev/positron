/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';

import { ParticipantService } from './participants.js';
import { MARKDOWN_DIR } from './constants';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { resolveGhostCellSuggestions } from './notebookAssistantMetadata.js';

/**
 * Result of a ghost cell suggestion generation
 */
export interface GhostCellSuggestionResult {
	/** The suggested code to insert */
	code: string;
	/** Brief explanation of what the code does */
	explanation: string;
	/** The language of the code (e.g., 'python', 'r') */
	language: string;
	/** The name of the model that generated the suggestion */
	modelName?: string;
	/** Whether a fallback model was used because the configured model was unavailable */
	usedFallback?: boolean;
}

/**
 * Progress callback for streaming partial results
 */
export type GhostCellProgressCallback = (partial: Partial<GhostCellSuggestionResult>) => void;

/** Timeout for fetching session variables (ms) */
const VARIABLE_FETCH_TIMEOUT_MS = 3000;

/** Max characters for a variable's display_value in the summary */
const VARIABLE_VALUE_MAX_LENGTH = 60;

/**
 * Valid XML tag names for parsing ghost cell suggestions
 */
type GhostCellTag = 'suggestion' | 'explanation' | 'code';

/**
 * Generate a ghost cell suggestion based on the just-executed cell.
 *
 * @param notebookUri URI of the notebook
 * @param executedCellIndex Index of the cell that was just executed
 * @param participantService Service for accessing the current chat model
 * @param log Log output channel for debugging
 * @param token Cancellation token
 * @param onProgress Optional callback for streaming partial results
 * @param skipConfigCheck If true, skip the config check (used when workbench has already verified)
 * @returns The suggestion result, or null if generation failed or was cancelled
 */
export async function generateGhostCellSuggestion(
	notebookUri: string,
	executedCellIndex: number,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
	onProgress?: GhostCellProgressCallback,
	skipConfigCheck?: boolean
): Promise<GhostCellSuggestionResult | null> {
	// Get the notebook document
	const uri = vscode.Uri.parse(notebookUri);
	const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === uri.toString());

	if (!notebook) {
		log.warn('[ghost-cell] Notebook not found:', notebookUri);
		return null;
	}

	// Check if ghost cell suggestions are enabled for this notebook
	// skipConfigCheck allows bypassing this when the workbench has already verified (e.g., user just clicked Enable)
	if (!skipConfigCheck && !resolveGhostCellSuggestions(notebook)) {
		log.debug('[ghost-cell] Ghost cell suggestions disabled for this notebook');
		return null;
	}

	// Validate cell index
	if (executedCellIndex < 0 || executedCellIndex >= notebook.cellCount) {
		log.warn('[ghost-cell] Invalid cell index:', executedCellIndex);
		return null;
	}

	const executedCell = notebook.cellAt(executedCellIndex);

	// Only suggest for code cells
	if (executedCell.kind !== vscode.NotebookCellKind.Code) {
		log.debug('[ghost-cell] Skipping non-code cell');
		return null;
	}

	// Start variable fetch concurrently with model selection
	const variablesSummaryPromise = fetchSessionVariablesSummary(uri, log);

	// Get the model to use for generation
	const modelSelection = await getModel(participantService, log);
	if (!modelSelection) {
		log.warn('[ghost-cell] No language model available');
		return null;
	}
	const { model, usedFallback } = modelSelection;
	const modelName = model.name;

	// Build context from the executed cell
	const cellContent = executedCell.document.getText();
	const language = executedCell.document.languageId;

	// Get cell outputs (simplified representation)
	const outputs = executedCell.outputs.map(output => {
		const textItems = output.items.filter(item =>
			item.mime === 'text/plain' ||
			item.mime === 'text/html' ||
			item.mime === 'application/vnd.code.notebook.stdout' ||
			item.mime === 'application/vnd.code.notebook.stderr'
		);
		return textItems.map(item => {
			const text = new TextDecoder().decode(item.data);
			// Truncate long outputs
			return text.length > 1000 ? text.substring(0, 1000) + '...' : text;
		}).join('\n');
	}).filter(Boolean).join('\n');

	// Check for errors in execution
	const hasError = executedCell.outputs.some(output =>
		output.items.some(item =>
			item.mime === 'application/vnd.code.notebook.error' ||
			item.mime === 'application/vnd.code.notebook.stderr'
		)
	);

	// Await variables (already fetching concurrently)
	const variablesSummary = await variablesSummaryPromise;

	// Build the context message
	const contextMessage = buildContextMessage(cellContent, outputs, language, hasError, executedCellIndex, notebook, variablesSummary);

	// Load the system prompt template
	const systemPrompt = await fs.promises.readFile(
		path.join(MARKDOWN_DIR, 'prompts', 'notebook', 'ghost-cell.md'),
		'utf8'
	);

	try {
		// Construct messages for the request
		const systemMessage = new vscode.LanguageModelChatMessage(
			vscode.LanguageModelChatMessageRole.System,
			systemPrompt
		);
		const userMessage = vscode.LanguageModelChatMessage.User(contextMessage);

		// Send request to LLM with timeout
		const timeoutMs = 30000;
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error('Ghost cell suggestion timed out')), timeoutMs);
		});

		const responsePromise = model.sendRequest([systemMessage, userMessage], {}, token);
		const response = await Promise.race([responsePromise, timeoutPromise]);

		// Parse streaming XML response
		const result = await parseStreamingXML(response.text, log, token, language, onProgress);
		if (result) {
			result.modelName = modelName;
			result.usedFallback = usedFallback;
		}
		return result;

	} catch (error) {
		if (token.isCancellationRequested) {
			log.debug('[ghost-cell] Generation cancelled');
			return null;
		}

		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`[ghost-cell] Error generating suggestion: ${errorMessage}`);
		return null;
	}
}

/**
 * Build the context message for the LLM based on the executed cell
 */
function buildContextMessage(
	cellContent: string,
	outputs: string,
	language: string,
	hasError: boolean,
	cellIndex: number,
	notebook: vscode.NotebookDocument,
	variablesSummary?: string
): string {
	const parts: string[] = [];

	parts.push(`## Notebook Context`);
	parts.push(`- Language: ${language}`);
	parts.push(`- Cell position: ${cellIndex + 1} of ${notebook.cellCount}`);
	if (hasError) {
		parts.push(`- Status: Cell execution produced an error`);
	} else {
		parts.push(`- Status: Cell executed successfully`);
	}
	parts.push('');

	parts.push(`## Just Executed Cell (Cell ${cellIndex + 1})`);
	parts.push('```' + language);
	parts.push(cellContent);
	parts.push('```');
	parts.push('');

	if (outputs) {
		parts.push(`## Cell Output`);
		parts.push('```');
		parts.push(outputs);
		parts.push('```');
		parts.push('');
	}

	// Include brief context from previous cells (last 2-3 cells)
	const prevCellsToInclude = Math.min(3, cellIndex);
	if (prevCellsToInclude > 0) {
		parts.push(`## Previous Context (last ${prevCellsToInclude} cells)`);
		for (let i = cellIndex - prevCellsToInclude; i < cellIndex; i++) {
			const cell = notebook.cellAt(i);
			if (cell.kind === vscode.NotebookCellKind.Code) {
				const content = cell.document.getText();
				// Only include brief snippets
				const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
				parts.push(`Cell ${i + 1}:`);
				parts.push('```' + cell.document.languageId);
				parts.push(truncated);
				parts.push('```');
			}
		}
	}

	if (variablesSummary) {
		parts.push('');
		parts.push('## Session Variables');
		parts.push('Variables currently defined in the runtime (name|type|value):');
		parts.push('```');
		parts.push(variablesSummary);
		parts.push('```');
	}

	parts.push('');
	parts.push('Based on this context, suggest the most logical next cell for the user to execute.');

	return parts.join('\n');
}

/**
 * Parse streaming XML response and build the suggestion result
 */
async function parseStreamingXML(
	textStream: AsyncIterable<string>,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
	language: string,
	onProgress?: GhostCellProgressCallback
): Promise<GhostCellSuggestionResult | null> {
	let explanation = '';
	let code = '';
	let currentField: 'explanation' | 'code' | null = null;
	let currentFieldContent = '';

	// Create streaming tag lexer
	const lexer = new StreamingTagLexer<GhostCellTag>({
		tagNames: ['suggestion', 'explanation', 'code'],
		contentHandler: async (chunk) => {
			if (chunk.type === 'tag') {
				if (chunk.name === 'explanation' || chunk.name === 'code') {
					if (chunk.kind === 'open') {
						currentField = chunk.name;
						currentFieldContent = '';
					} else if (chunk.kind === 'close' && currentField) {
						if (currentField === 'explanation') {
							explanation = currentFieldContent.trim();
							onProgress?.({ explanation });
						} else if (currentField === 'code') {
							code = currentFieldContent.trim();
							onProgress?.({ code });
						}
						currentField = null;
						currentFieldContent = '';
					}
				}
			} else {
				// Accumulate text content for the current field
				if (currentField) {
					currentFieldContent += chunk.text;
					// Stream partial updates for code
					if (currentField === 'code') {
						onProgress?.({ code: currentFieldContent.trim() });
					}
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
			await lexer.process(delta);
		}

		// Flush any remaining content
		await lexer.flush();
	} catch (error) {
		log.error(`[ghost-cell] Error during XML streaming: ${error}`);
		return null;
	}

	// Validate result
	if (!code) {
		log.warn('[ghost-cell] No code generated in suggestion');
		return null;
	}

	return {
		code,
		explanation: explanation || 'Suggested next step',
		language
	};
}

/**
 * Get the priority of a variable based on its display_type.
 * Lower number = higher priority (included first in the summary).
 *
 * Priority 1: Tables/data structures (DataFrame, tibble, Series, etc.)
 * Priority 2: Collections (list, dict, vector, etc.)
 * Priority 3: Scalars (int, float, str, bool, etc.)
 * Priority 4: Everything else (module, function, class, etc.)
 */
function getVariablePriority(displayType: string): number {
	const t = displayType.toLowerCase();

	// Priority 1: tables and data structures
	const tableTypes = ['dataframe', 'data.frame', 'tibble', 'series', 'matrix', 'array', 'ndarray'];
	if (tableTypes.some(tt => t.includes(tt))) {
		return 1;
	}

	// Priority 2: collections
	const collectionTypes = ['list', 'dict', 'set', 'tuple', 'vector', 'environment'];
	if (collectionTypes.some(ct => t.includes(ct))) {
		return 2;
	}

	// Priority 3: scalars
	const scalarTypes = ['int', 'float', 'str', 'bool', 'numeric', 'character', 'logical', 'complex', 'double'];
	if (scalarTypes.some(st => t.includes(st))) {
		return 3;
	}

	// Priority 4: everything else
	return 4;
}

/**
 * Fetch a summary of session variables for the given notebook.
 *
 * Returns a pipe-delimited summary string (name|type|value per line),
 * or empty string if variables cannot be fetched (no session, timeout, error).
 */
async function fetchSessionVariablesSummary(
	notebookUri: vscode.Uri,
	log: vscode.LogOutputChannel
): Promise<string> {
	const config = vscode.workspace.getConfiguration('positron.assistant.notebook');
	const maxVariables = config.get<number>('ghostCellSuggestions.maxVariables', 20);

	if (maxVariables === 0) {
		log.debug('[ghost-cell] Variable context disabled (maxVariables=0)');
		return '';
	}

	try {
		const result = await Promise.race([
			fetchVariablesFromSession(notebookUri, maxVariables, log),
			new Promise<string>((_, reject) =>
				setTimeout(() => reject(new Error('Variable fetch timed out')), VARIABLE_FETCH_TIMEOUT_MS)
			),
		]);
		return result;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		log.debug(`[ghost-cell] Could not fetch session variables: ${msg}`);
		return '';
	}
}

/**
 * Inner helper that fetches variables from the runtime session.
 */
async function fetchVariablesFromSession(
	notebookUri: vscode.Uri,
	maxVariables: number,
	log: vscode.LogOutputChannel
): Promise<string> {
	const session = await positron.runtime.getNotebookSession(notebookUri);
	if (!session) {
		log.debug('[ghost-cell] No runtime session for notebook');
		return '';
	}

	const allVariables = await positron.runtime.getSessionVariables(session.metadata.sessionId);
	const rootVariables = allVariables[0] || [];

	if (rootVariables.length === 0) {
		log.debug('[ghost-cell] No variables in session');
		return '';
	}

	// Sort by priority (lower = more relevant) then take top N
	const sorted = [...rootVariables].sort(
		(a, b) => getVariablePriority(a.display_type) - getVariablePriority(b.display_type)
	);
	const selected = sorted.slice(0, maxVariables);

	// Format as pipe-delimited lines
	const lines = selected.map(v => {
		const value = v.display_value.length > VARIABLE_VALUE_MAX_LENGTH
			? v.display_value.substring(0, VARIABLE_VALUE_MAX_LENGTH) + '...'
			: v.display_value;
		return `${v.display_name}|${v.display_type}|${value}`;
	});

	log.debug(`[ghost-cell] Including ${lines.length} of ${rootVariables.length} session variables`);
	return lines.join('\n');
}

/**
 * Result of model selection
 */
interface ModelSelectionResult {
	model: vscode.LanguageModelChat;
	/** True if the configured model was not available and we fell back to another model */
	usedFallback: boolean;
}

/**
 * Get the language model to use for generation.
 * Follows the same pattern as notebookSuggestions.ts
 */
async function getModel(
	participantService: ParticipantService,
	log: vscode.LogOutputChannel
): Promise<ModelSelectionResult | null> {
	// Log all available models for debugging
	const allModels = await vscode.lm.selectChatModels();
	log.debug(`[ghost-cell] Available models: ${allModels.length} total`);

	// Check configuration setting first (highest priority)
	const config = vscode.workspace.getConfiguration('positron.assistant.notebook');
	const configuredPatterns = config.get<string[]>('ghostCellSuggestions.model') || [];
	const hasConfiguredModel = configuredPatterns.length > 0 && configuredPatterns.some(p => p && p.trim() !== '');

	if (hasConfiguredModel) {
		log.debug(`[ghost-cell] Checking configured model patterns: ${JSON.stringify(configuredPatterns)}`);
		for (const pattern of configuredPatterns) {
			if (!pattern || pattern.trim() === '') {
				continue;
			}
			const patternLower = pattern.toLowerCase();
			// Try exact ID match first
			const exactMatch = allModels.find(m => m.id === pattern);
			if (exactMatch) {
				log.debug(`[ghost-cell] Using configured model (exact match): ${exactMatch.name}`);
				return { model: exactMatch, usedFallback: false };
			}
			// Try partial match
			const partialMatch = allModels.find(m =>
				m.id.toLowerCase().includes(patternLower) || m.name.toLowerCase().includes(patternLower)
			);
			if (partialMatch) {
				log.debug(`[ghost-cell] Using configured model (partial match): ${partialMatch.name}`);
				return { model: partialMatch, usedFallback: false };
			}
		}
		// User configured a model but none matched - we'll fall back but mark it
		log.warn(`[ghost-cell] Configured model patterns not found: ${JSON.stringify(configuredPatterns)}`);
	}

	// Check for the latest chat session and use its model
	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		const models = await vscode.lm.selectChatModels({ 'id': sessionModelId });
		if (models && models.length > 0) {
			log.debug(`[ghost-cell] Using session model: ${models[0].name}`);
			return { model: models[0], usedFallback: hasConfiguredModel };
		}
	}

	// Fall back to the first model for the currently selected provider
	const currentProvider = await positron.ai.getCurrentProvider();
	if (currentProvider) {
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		if (models && models.length > 0) {
			log.debug(`[ghost-cell] Using provider model: ${models[0].name}`);
			return { model: models[0], usedFallback: hasConfiguredModel };
		}
	}

	// Fall back to any available model
	const [firstModel] = await vscode.lm.selectChatModels();
	if (firstModel) {
		log.debug(`[ghost-cell] Using fallback model: ${firstModel.name}`);
		return { model: firstModel, usedFallback: hasConfiguredModel };
	}

	return null;
}
