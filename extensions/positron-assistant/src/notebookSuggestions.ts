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
	log.info(`[notebook-suggestions] Generating suggestions for notebook: ${notebookUri}`);

	// Get the model to use for generation
	const model = await getModel(participantService);
	log.info(`[notebook-suggestions] Using model (${model.vendor}) ${model.id}`);

	// Get notebook context
	const context = await positron.notebooks.getContext();
	if (!context) {
		log.warn('[notebook-suggestions] No notebook context available');
		return [];
	}

	// Get all cells if not already included in context
	const allCells = context.allCells || await positron.notebooks.getCells(notebookUri);

	// Build context summary for the prompt
	const contextSummary = buildContextSummary(context, allCells);
	log.trace(`[notebook-suggestions] Context summary:\n${contextSummary}`);

	// Load the system prompt template
	const systemPrompt = await fs.promises.readFile(
		path.join(MARKDOWN_DIR, 'prompts', 'notebook', 'suggestions.md'),
		'utf8'
	);

	try {
		// Send request to LLM
		const response = await model.sendRequest([
			new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.System,
				systemPrompt
			),
			vscode.LanguageModelChatMessage.User(contextSummary)
		], {}, token);

		// Accumulate the response
		let jsonResponse = '';
		for await (const delta of response.text) {
			if (token.isCancellationRequested) {
				log.info('[notebook-suggestions] Generation cancelled by user');
				return [];
			}
			jsonResponse += delta;
		}

		log.trace(`[notebook-suggestions] Raw LLM response:\n${jsonResponse}`);

		// Parse and validate the JSON response
		const suggestions = parseAndValidateSuggestions(jsonResponse, log);
		log.info(`[notebook-suggestions] Generated ${suggestions.length} suggestions`);

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
 * Build a context summary string from notebook context
 */
function buildContextSummary(
	context: positron.notebooks.NotebookContext,
	allCells: positron.notebooks.NotebookCell[]
): string {
	const parts: string[] = [];

	// Basic info
	parts.push(`Notebook: ${context.uri}`);
	parts.push(`Kernel Language: ${context.kernelLanguage || 'unknown'}`);
	parts.push(`Total Cells: ${context.cellCount}`);
	parts.push(`Selected Cells: ${context.selectedCells.length}`);

	// Cell type breakdown
	const codeCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Code);
	const markdownCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Markdown);
	parts.push(`Code Cells: ${codeCells.length}`);
	parts.push(`Markdown Cells: ${markdownCells.length}`);

	// Execution status
	const executedCells = codeCells.filter(c => c.executionOrder !== undefined);
	const failedCells = codeCells.filter(c => c.lastRunSuccess === false);
	const cellsWithOutput = allCells.filter(c => c.hasOutput);
	parts.push(`Executed Cells: ${executedCells.length}`);
	parts.push(`Failed Cells: ${failedCells.length}`);
	parts.push(`Cells with Output: ${cellsWithOutput.length}`);

	// Selected cell content (if any)
	if (context.selectedCells.length > 0) {
		parts.push('\n## Selected Cells:');
		context.selectedCells.forEach(cell => {
			parts.push(`\n### Cell ${cell.index} (${cell.type})`);
			if (cell.type === positron.notebooks.NotebookCellType.Code) {
				parts.push(`Status: ${cell.executionStatus || 'not executed'}`);
				if (cell.lastRunSuccess !== undefined) {
					parts.push(`Last Run: ${cell.lastRunSuccess ? 'success' : 'failed'}`);
				}
			}
			// Include a snippet of the content (first 200 characters)
			const contentSnippet = cell.content.substring(0, 200);
			parts.push(`Content: ${contentSnippet}${cell.content.length > 200 ? '...' : ''}`);
		});
	}

	// Recent cells (last 3 executed cells if no selection)
	if (context.selectedCells.length === 0 && executedCells.length > 0) {
		const recentCells = executedCells
			.sort((a, b) => (b.executionOrder || 0) - (a.executionOrder || 0))
			.slice(0, 3);

		parts.push('\n## Recently Executed Cells:');
		recentCells.forEach(cell => {
			parts.push(`\n### Cell ${cell.index}`);
			parts.push(`Status: ${cell.executionStatus || 'completed'}`);
			parts.push(`Success: ${cell.lastRunSuccess ? 'yes' : 'no'}`);
			const contentSnippet = cell.content.substring(0, 150);
			parts.push(`Content: ${contentSnippet}${cell.content.length > 150 ? '...' : ''}`);
		});
	}

	return parts.join('\n');
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

		// Parse the JSON
		const parsed = JSON.parse(jsonString);

		// Ensure it's an array
		const suggestions = Array.isArray(parsed) ? parsed : [parsed];

		// Validate and normalize each suggestion
		return suggestions
			.filter(s => validateSuggestion(s, log))
			.map(s => normalizeSuggestion(s))
			.slice(0, 5); // Limit to 5 suggestions

	} catch (error) {
		log.error(`[notebook-suggestions] Failed to parse LLM response as JSON: ${error}`);
		log.trace(`[notebook-suggestions] Attempted to parse: ${jsonResponse}`);
		return [];
	}
}

/**
 * Validate that a suggestion object has required fields
 */
function validateSuggestion(suggestion: any, log: vscode.LogOutputChannel): boolean {
	if (!suggestion || typeof suggestion !== 'object') {
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
 * Normalize a suggestion object to match the expected interface
 */
function normalizeSuggestion(suggestion: any): NotebookActionSuggestion {
	// Normalize mode to valid values
	let mode: 'ask' | 'edit' | 'agent' = 'agent';
	if (suggestion.mode === 'ask' || suggestion.mode === 'edit' || suggestion.mode === 'agent') {
		mode = suggestion.mode;
	}

	return {
		label: suggestion.label,
		detail: suggestion.detail || undefined,
		query: suggestion.query,
		mode,
		iconClass: suggestion.iconClass || undefined
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
