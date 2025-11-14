/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as xml from '../xml.js';
import { calculateSlidingWindow, filterNotebookContext, MAX_CELLS_FOR_ALL_CELLS_CONTEXT } from '../notebookContextFilter.js';

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

/**
 * Options for serializing notebook context
 */
export interface NotebookContextSerializationOptions {
	/** Optional anchor for sliding window. Defaults: last selected cell → last executed cell → 0 */
	anchorIndex?: number;
	/** Default: false. If true, wraps everything in <notebook-context> node (for suggestions format) */
	wrapInNotebookContext?: boolean;
}

/**
 * Serialized notebook context components
 */
export interface SerializedNotebookContext {
	/** Kernel information XML node */
	kernelInfo: string;
	/** Cell count information XML node (used internally in wrapped format) */
	cellCountInfo?: string;
	/** Selected cells XML (may be empty if no selection) */
	selectedCellsInfo: string;
	/** All cells XML (present if cells available after filtering) */
	allCellsInfo?: string;
	/** Context note XML */
	contextNote: string;
	/** Full wrapped context (if wrapInNotebookContext is true) */
	fullContext?: string;
}

/**
 * Serialize notebook context to XML format with integrated filtering logic.
 *
 * This function serves as the single source of truth for notebook context serialization
 * across notebook suggestions, chat pane prompts, and inline chat. It handles filtering
 * internally and generates consistent XML components.
 *
 * @param context The notebook context to serialize
 * @param options Serialization options
 * @returns Serialized notebook context components
 */
export function serializeNotebookContext(
	context: positron.notebooks.NotebookContext,
	options: NotebookContextSerializationOptions = {}
): SerializedNotebookContext {
	const { anchorIndex, wrapInNotebookContext = false } = options;

	// Get all cells from context (may already be filtered)
	const allCells = context.allCells || [];
	const totalCells = context.cellCount;

	// Determine anchor index for sliding window if not provided
	let effectiveAnchorIndex: number;
	if (anchorIndex !== undefined) {
		effectiveAnchorIndex = anchorIndex;
	} else if (context.selectedCells.length > 0) {
		// Use last selected cell index
		effectiveAnchorIndex = Math.max(...context.selectedCells.map(cell => cell.index));
	} else {
		// Try to find last executed cell
		const codeCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Code);
		const executedCells = codeCells.filter(c => c.executionOrder !== undefined);
		if (executedCells.length > 0) {
			effectiveAnchorIndex = Math.max(...executedCells.map(c => c.index));
		} else {
			// Fallback to 0
			effectiveAnchorIndex = 0;
		}
	}

	// Apply filtering logic to determine which cells to include
	let cellsToInclude: positron.notebooks.NotebookCell[];

	if (totalCells < MAX_CELLS_FOR_ALL_CELLS_CONTEXT) {
		// Small notebooks: include all cells
		cellsToInclude = allCells.length > 0 ? allCells : [];
	} else if (context.selectedCells.length === 0 && allCells.length === 0) {
		// Large notebooks without selection and no allCells: no cells to include
		cellsToInclude = [];
	} else if (context.selectedCells.length === 0) {
		// Large notebooks without selection: use sliding window around executed cells
		const codeCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Code);
		const executedCells = codeCells.filter(c => c.executionOrder !== undefined);
		if (executedCells.length > 0 || effectiveAnchorIndex !== 0) {
			const { startIndex, endIndex } = calculateSlidingWindow(allCells.length, effectiveAnchorIndex);
			cellsToInclude = allCells.slice(startIndex, endIndex);
		} else {
			// No executed cells, use first 20 cells
			cellsToInclude = allCells.slice(0, MAX_CELLS_FOR_ALL_CELLS_CONTEXT);
		}
	} else {
		// Large notebooks with selection: use sliding window around anchor
		if (allCells.length > 0) {
			const { startIndex, endIndex } = calculateSlidingWindow(allCells.length, effectiveAnchorIndex);
			cellsToInclude = allCells.slice(startIndex, endIndex);
		} else {
			cellsToInclude = [];
		}
	}

	// Generate kernel info XML (using xml.node for consistency)
	const kernelInfo = context.kernelId
		? xml.node('kernel', '', {
			language: context.kernelLanguage || 'unknown',
			id: context.kernelId
		})
		: xml.node('kernel', 'No kernel attached');

	// Generate cell count info XML
	const cellCountInfo = xml.node('cell-count', '', {
		total: context.cellCount,
		selected: context.selectedCells.length,
		included: cellsToInclude.length
	});

	// Generate selected cells XML
	const selectedCellsInfo = formatCells({ cells: context.selectedCells, prefix: 'Selected Cell' });

	// Generate all cells XML if available
	let allCellsInfo: string | undefined;
	let formattedCells: string | undefined;
	if (cellsToInclude.length > 0) {
		const isFullNotebook = context.cellCount < 20;
		const description = isFullNotebook
			? 'All cells in notebook (notebook has fewer than 20 cells)'
			: 'Context window around selected/recent cells (notebook has 20+ cells)';
		// Format cells once and reuse
		formattedCells = formatCells({ cells: cellsToInclude, prefix: 'Cell' });
		allCellsInfo = xml.node('all-cells', formattedCells, {
			description
		});
	}

	// Generate context note XML
	let contextNote: string;
	if (cellsToInclude.length > 0) {
		if (context.cellCount < 20) {
			contextNote = xml.node('note', 'All cells are provided above because this notebook has fewer than 20 cells.');
		} else {
			contextNote = xml.node('note', 'A context window around the selected/recent cells is provided above. Use the GetNotebookCells tool to retrieve additional cells by index when needed.');
		}
	} else {
		contextNote = xml.node('note', 'Only selected cells are shown above to conserve tokens. Use the GetNotebookCells tool to retrieve additional cells by index when needed.');
	}

	// Build result
	const result: SerializedNotebookContext = {
		kernelInfo,
		cellCountInfo,
		selectedCellsInfo,
		allCellsInfo,
		contextNote
	};

	// Optionally wrap in notebook-context node
	if (wrapInNotebookContext) {
		const isFullNotebook = context.cellCount < 20;
		const contextMode = isFullNotebook
			? 'Full notebook (< 20 cells, all cells provided below)'
			: 'Context window around selected/recent cells (notebook has 20+ cells)';

		const contextModeNode = xml.node('context-mode', contextMode);
		const notebookInfo = xml.node('notebook-info', `${kernelInfo}\n${cellCountInfo}`);

		const parts: string[] = [xml.node('notebook-context', `${notebookInfo}\n${contextModeNode}`)];

		if (context.selectedCells.length > 0) {
			parts.push(xml.node('selected-cells', selectedCellsInfo));
		}

		if (allCellsInfo) {
			parts.push(allCellsInfo);
		}

		parts.push(contextNote);

		result.fullContext = parts.join('\n\n');
	}

	return result;
}

/**
 * Checks if there is an attached notebook context without applying filtering or serialization.
 * Returns the raw notebook context if:
 * 1. Notebook mode feature is enabled
 * 2. A notebook editor is currently active
 * 3. That notebook's URI is attached as context
 *
 * This is useful for tool availability checks that don't need the full filtered/serialized context.
 *
 * @param request The chat request to check for attached notebook context
 * @returns The raw notebook context if attached, undefined otherwise
 */
async function getRawAttachedNotebookContext(
	request: vscode.ChatRequest
): Promise<positron.notebooks.NotebookContext | undefined> {
	// Check if notebook mode feature is enabled
	const notebookModeEnabled = vscode.workspace
		.getConfiguration('positron.assistant.notebookMode')
		.get('enable', false);

	if (!notebookModeEnabled) {
		return undefined;
	}

	// Get active editor's notebook context (unfiltered from main thread)
	const activeContext = await positron.notebooks.getContext();
	if (!activeContext) {
		return undefined;
	}

	// Extract attached notebook URIs
	const attachedNotebookUris = request.references
		.map(ref => {
			// Check for activeSession.notebookUri
			const sessionNotebookUri = (ref.value as any)?.activeSession?.notebookUri;
			if (typeof sessionNotebookUri === 'string') {
				return sessionNotebookUri;
			}
			// Check for direct .ipynb file reference
			if (ref.value instanceof vscode.Uri && ref.value.path.endsWith('.ipynb')) {
				return ref.value.toString();
			}
			return undefined;
		})
		.filter(uri => typeof uri === 'string');

	if (attachedNotebookUris.length === 0) {
		return undefined;
	}

	// Check if active notebook is in attached context
	const isActiveNotebookAttached = attachedNotebookUris.includes(
		activeContext.uri
	);

	if (!isActiveNotebookAttached) {
		return undefined;
	}

	return activeContext;
}

/**
 * Checks if there is an attached notebook context.
 * Returns true if:
 * 1. Notebook mode feature is enabled
 * 2. A notebook editor is currently active
 * 3. That notebook's URI is attached as context
 *
 * This is a lightweight check for tool availability that doesn't require
 * filtering or serialization of the notebook context.
 *
 * @param request The chat request to check for attached notebook context
 * @returns True if there is an attached notebook context, false otherwise
 */
export async function hasAttachedNotebookContext(
	request: vscode.ChatRequest
): Promise<boolean> {
	const context = await getRawAttachedNotebookContext(request);
	return context !== undefined;
}

/**
 * Checks if notebook mode should be enabled based on attached context.
 * Returns filtered notebook context only if:
 * 1. A notebook editor is currently active
 * 2. That notebook's URI is attached as context
 *
 * Applies filtering to limit context size for large notebooks.
 */
export async function getAttachedNotebookContext(
	request: vscode.ChatRequest
): Promise<SerializedNotebookContext | undefined> {
	const activeContext = await getRawAttachedNotebookContext(request);
	if (!activeContext) {
		return undefined;
	}

	// Apply filtering before returning context
	const filteredContext = filterNotebookContext(activeContext);
	return serializeNotebookContext(filteredContext);
}
