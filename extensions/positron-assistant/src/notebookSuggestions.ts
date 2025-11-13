/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';

import { ParticipantService } from './participants.js';
import { MARKDOWN_DIR } from './constants';
import { serializeNotebookContext } from './tools/notebookUtils.js';

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
 * Raw suggestion object structure as parsed from JSON
 * Used for type-safe validation of LLM responses
 */
interface RawSuggestion {
	label?: unknown;
	detail?: unknown;
	query?: unknown;
	mode?: unknown;
	iconClass?: unknown;
}

/**
 * Type guard to check if a value is a record-like object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Generate AI-powered action suggestions based on notebook context
 * @param notebookUri URI of the notebook to analyze
 * @param participantService Service for accessing the current chat model
 * @param log Log output channel for debugging
 * @param token Cancellation token
 * @returns Array of suggested actions
 */
export async function generateNotebookSuggestions(
	notebookUri: string,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken
): Promise<NotebookActionSuggestion[]> {
	// Get the model to use for generation
	const model = await getModel(participantService);

	// Get notebook context
	const context = await positron.notebooks.getContext();
	if (!context) {
		log.warn('[notebook-suggestions] No notebook context available');
		return [];
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

		// Accumulate the response
		let jsonResponse = '';
		for await (const delta of response.text) {
			if (token.isCancellationRequested) {
				return [];
			}
			jsonResponse += delta;
		}

		// Parse and validate the JSON response
		const suggestions = parseAndValidateSuggestions(jsonResponse, log);

		return suggestions;

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`[notebook-suggestions] Error generating suggestions: ${errorMessage}`);

		// Return empty array rather than throwing to allow graceful degradation
		vscode.window.showWarningMessage(
			`Failed to generate AI suggestions: ${errorMessage}. Please try again or use predefined actions.`
		);
		return [];
	}
}

/**
 * Parse and validate the LLM response as JSON suggestions
 */
function parseAndValidateSuggestions(
	jsonResponse: string,
	log: vscode.LogOutputChannel
): NotebookActionSuggestion[] {
	try {
		// Extract JSON from potential markdown code blocks
		let jsonString = jsonResponse.trim();

		// Remove markdown code fence if present
		const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (codeBlockMatch) {
			jsonString = codeBlockMatch[1].trim();
		}

		// Parse the JSON - result is unknown, not any
		const parsed: unknown = JSON.parse(jsonString);

		// Ensure it's an array of unknown values
		const suggestions: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

		// Validate and normalize each suggestion
		// Type guard narrows unknown to RawSuggestion, then normalize converts to NotebookActionSuggestion
		return suggestions
			.filter((s): s is RawSuggestion => validateSuggestion(s, log))
			.map(s => normalizeSuggestion(s))
			.slice(0, 5); // Limit to 5 suggestions

	} catch (error) {
		log.error(`[notebook-suggestions] Failed to parse LLM response as JSON: ${error}`);
		return [];
	}
}

/**
 * Type guard to validate that a suggestion object has required fields
 * @param suggestion The unknown value to validate
 * @param log Log output channel for debugging
 * @returns True if the suggestion is a valid RawSuggestion
 */
function validateSuggestion(suggestion: unknown, log: vscode.LogOutputChannel): suggestion is RawSuggestion {
	if (!isRecord(suggestion)) {
		log.warn('[notebook-suggestions] Invalid suggestion: not an object');
		return false;
	}

	if (!suggestion.label || typeof suggestion.label !== 'string') {
		log.warn('[notebook-suggestions] Invalid suggestion: missing or invalid label');
		return false;
	}

	if (!suggestion.query || typeof suggestion.query !== 'string') {
		log.warn('[notebook-suggestions] Invalid suggestion: missing or invalid query');
		return false;
	}

	return true;
}

/**
 * Normalize a validated suggestion object to match the expected interface
 * @param suggestion The validated raw suggestion from JSON parsing
 * @returns Normalized NotebookActionSuggestion
 */
function normalizeSuggestion(suggestion: RawSuggestion): NotebookActionSuggestion {
	// Normalize mode to valid values
	let mode: 'ask' | 'edit' | 'agent' = 'agent';
	if (suggestion.mode === 'ask' || suggestion.mode === 'edit' || suggestion.mode === 'agent') {
		mode = suggestion.mode;
	}

	// validateSuggestion ensures label and query are strings, so these are safe to use
	// We still check at runtime for extra safety
	if (typeof suggestion.label !== 'string' || typeof suggestion.query !== 'string') {
		throw new Error('Invalid suggestion: label and query must be strings');
	}

	return {
		label: suggestion.label,
		detail: typeof suggestion.detail === 'string' ? suggestion.detail : undefined,
		query: suggestion.query,
		mode,
		iconClass: typeof suggestion.iconClass === 'string' ? suggestion.iconClass : undefined
	};
}

/**
 * Get the language model to use for generation
 * Follows the same pattern as git.ts
 */
async function getModel(participantService: ParticipantService): Promise<vscode.LanguageModelChat> {
	// Check for the latest chat session and use its model
	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		const models = await vscode.lm.selectChatModels({ 'id': sessionModelId });
		if (models && models.length > 0) {
			return models[0];
		}
	}

	// Fall back to the first model for the currently selected provider
	const currentProvider = await positron.ai.getCurrentProvider();
	if (currentProvider) {
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		if (models && models.length > 0) {
			return models[0];
		}
	}

	// Fall back to any available model
	const [firstModel] = await vscode.lm.selectChatModels();
	if (!firstModel) {
		throw new Error('No language model available');
	}

	return firstModel;
}
