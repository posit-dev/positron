/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Maximum preview length per cell for confirmations (characters)
 */
const MAX_CELL_PREVIEW_LENGTH = 500;

/**
 * Maximum cell content length (1MB)
 */
export const MAX_CELL_CONTENT_LENGTH = 1_000_000;

/**
 * Validation result for cell indices
 */
export interface CellIndexValidation {
	valid: boolean;
	error?: string;
}

/**
 * Validates an array of cell indices against the total cell count.
 *
 * @param indices Array of cell indices to validate
 * @param cellCount Total number of cells in the notebook
 * @param allowEmpty Whether to allow an empty array (default: false)
 * @returns Validation result with error message if invalid
 */
export function validateCellIndices(
	indices: number[],
	cellCount: number,
	allowEmpty: boolean = false
): CellIndexValidation {
	// Check for empty array
	if (indices.length === 0) {
		if (allowEmpty) {
			return { valid: true };
		}
		return { valid: false, error: 'Cell indices array cannot be empty' };
	}

	// Validate each index
	for (const index of indices) {
		// Check if integer
		if (!Number.isInteger(index)) {
			return { valid: false, error: `Cell index must be an integer: ${index}` };
		}

		// Check if negative
		if (index < 0) {
			return { valid: false, error: `Cell index cannot be negative: ${index}` };
		}

		// Check if within bounds
		if (index >= cellCount) {
			return { valid: false, error: `Cell index ${index} is out of bounds (notebook has ${cellCount} cells, valid indices: 0-${cellCount - 1})` };
		}
	}

	return { valid: true };
}

/**
 * Fetches and formats cell content for preview in confirmation dialogs.
 * Truncates long content with ellipsis.
 *
 * @param uri The notebook URI (as string)
 * @param cellIndices Array of cell indices to preview
 * @returns Formatted preview string with cell content
 */
export async function getCellsPreview(
	uri: string,
	cellIndices: number[]
): Promise<string> {
	const previews: string[] = [];

	for (const cellIndex of cellIndices) {
		try {
			const cell = await positron.notebooks.getCell(uri, cellIndex);
			if (!cell) {
				previews.push(`Cell ${cellIndex}: [Cell not found]`);
				continue;
			}

			let content = cell.content.trim();
			if (content.length > MAX_CELL_PREVIEW_LENGTH) {
				content = content.substring(0, MAX_CELL_PREVIEW_LENGTH) + '...';
			}

			previews.push(`Cell ${cellIndex} (${cell.type}):\n${content}`);
		} catch (error) {
			previews.push(`Cell ${cellIndex}: [Error fetching cell]`);
		}
	}

	return previews.join('\n\n');
}

/**
 * Format cell status information for display in prompts
 */
function formatCellStatus(cell: positron.notebooks.NotebookCell): string {
	const statusParts: string[] = [];

	// Selection status
	statusParts.push(`Selection: ${cell.selectionStatus}`);

	// Execution status (only for code cells)
	if (cell.executionStatus !== undefined) {
		statusParts.push(`Execution: ${cell.executionStatus}`);
		if (cell.executionOrder !== undefined) {
			statusParts.push(`Order: [${cell.executionOrder}]`);
		}
		if (cell.lastRunSuccess !== undefined) {
			statusParts.push(`Last run: ${cell.lastRunSuccess ? 'success' : 'failed'}`);
		}
		if (cell.lastExecutionDuration !== undefined) {
			const durationMs = cell.lastExecutionDuration;
			const durationStr = durationMs < 1000
				? `${durationMs}ms`
				: `${(durationMs / 1000).toFixed(2)}s`;
			statusParts.push(`Duration: ${durationStr}`);
		}
	}

	// Output status
	statusParts.push(cell.hasOutput ? 'Has output' : 'No output');

	return statusParts.join(' | ');
}

/**
 * Options for formatting notebook cells
 */
export interface FormatCellsOptions {
	/** The notebook cells to format */
	cells: positron.notebooks.NotebookCell[];
	/** The prefix to use for cell labels (e.g., 'Selected Cell', 'Cell') */
	prefix: string;
	/** Whether to include cell content in the output. Defaults to true. */
	includeContent?: boolean;
}

/**
 * Format a collection of cells for display in prompts using XML format
 *
 * @param options Options for formatting cells
 * @returns A formatted XML string describing all cells, separated by single newlines
 */
export function formatCells(options: FormatCellsOptions): string {
	const { cells, prefix, includeContent = true } = options;

	if (cells.length === 0) {
		return prefix === 'Selected Cell' ? 'No cells currently selected' : '';
	}

	return cells.map((cell, idx) => {
		const statusInfo = formatCellStatus(cell);
		const cellLabel = cells.length === 1
			? prefix
			: `${prefix} ${idx + 1}`;
		const parts = [
			`<cell index="${cell.index}" type="${cell.type}">`,
			`  <label>${cellLabel}</label>`,
			`  <status>${statusInfo}</status>`,
			includeContent ? `<content>${cell.content}</content>` : '',
			`</cell>`
		];
		return parts.filter(Boolean).join('\n');
	}).join('\n');
}

/**
 * Convert notebook cell outputs to LanguageModel parts (text and image data).
 * Handles both text and image outputs, converting base64 image data to binary format.
 *
 * @param outputs Array of notebook cell outputs to convert
 * @param prefixText Optional text to prepend before the outputs
 * @returns Array of LanguageModel parts ready for use in tool results
 */
export function convertOutputsToLanguageModelParts(
	outputs: positron.notebooks.NotebookCellOutput[],
	prefixText?: string
): (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] {
	const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];

	// Add prefix text if provided
	if (prefixText) {
		resultParts.push(new vscode.LanguageModelTextPart(prefixText));
	}

	// Convert each output to appropriate LanguageModel part
	for (const output of outputs) {
		if (output.mimeType.startsWith('image/')) {
			// Handle image outputs - convert base64 to binary
			if (!output.data) {
				resultParts.push(new vscode.LanguageModelTextPart('[Image data unavailable]'));
				continue;
			}
			const imageBuffer = Buffer.from(output.data, 'base64');
			const imageData = new Uint8Array(imageBuffer);
			resultParts.push(new vscode.LanguageModelDataPart(imageData, output.mimeType));
		} else {
			// Handle text outputs
			let textContent = output.data;
			// Add newline before text output if there are already parts (for readability)
			if (resultParts.length > 0) {
				textContent = '\n' + textContent;
			}
			resultParts.push(new vscode.LanguageModelTextPart(textContent));
		}
	}

	return resultParts;
}
