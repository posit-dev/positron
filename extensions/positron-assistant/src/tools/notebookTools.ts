/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';
import { convertOutputsToLanguageModelParts, formatCellStatus } from './notebookUtils.js';

/**
 * Gets the active notebook context, returning null if no notebook is active.
 *
 * @returns The notebook context, or null if no notebook is active
 */
async function getActiveNotebookContext(): Promise<positron.notebooks.NotebookContext | null> {
	return await positron.notebooks.getContext();
}

/**
 * Creates an error result for when no active notebook is found.
 *
 * @returns A LanguageModelToolResult indicating no active notebook
 */
function createNoActiveNotebookErrorResult(): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart('No active notebook found')
	]);
}

/**
 * Creates an error result for notebook tool operations, logging the error.
 *
 * @param error The error that occurred
 * @param toolName The name of the tool that failed
 * @param operation A description of the operation that failed (e.g., 'execute cells', 'add cell')
 * @returns A LanguageModelToolResult with the error message
 */
function createNotebookToolErrorResult(
	error: unknown,
	toolName: string,
	operation: string
): vscode.LanguageModelToolResult {
	const errorMessage = error instanceof Error ? error.message : String(error);
	log.error(`[${toolName}] Failed to ${operation}: ${errorMessage}`);
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart(`Failed to ${operation}: ${errorMessage}`)
	]);
}

/**
 * Formats an array of notebook cells into a markdown string representation.
 *
 * @param cells The notebook cells to format
 * @returns A formatted markdown string describing all cells, separated by double newlines
 */
function formatCellsInfo(cells: positron.notebooks.NotebookCell[]): string {
	return cells.map(cell => {
		const statusInfo = formatCellStatus(cell);
		const parts = [
			`### Cell ${cell.index} (${cell.type})`,
			`ID: ${cell.id}`,
			`Status: ${statusInfo}`,
			'```',
			cell.content,
			'```'
		];
		return parts.join('\n');
	}).join('\n\n');
}

/**
 * Tool: Run Notebook Cells
 *
 * Executes one or more cells in the active notebook and returns their outputs.
 * Supports both text and image outputs.
 */
export const RunNotebookCellsTool = vscode.lm.registerTool<{
	cellIds: string[];
}>(PositronAssistantToolName.RunNotebookCells, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Running notebook cells'),
			pastTenseMessage: vscode.l10n.t('Ran notebook cells'),
		};
	},
	invoke: async (options, token) => {
		const cellIds = options.input.cellIds;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			await positron.notebooks.runCells(context.uri, cellIds);

			// Build mixed content response with support for images
			const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
			resultParts.push(
				new vscode.LanguageModelTextPart(`Successfully executed ${cellIds.length} cell(s).\n\nOutputs:\n`)
			);

			for (const cellId of cellIds) {
				const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, cellId);

				if (cellOutputs.length > 0) {
					resultParts.push(new vscode.LanguageModelTextPart(`\nCell ${cellId}:\n`));
					// Convert outputs to LanguageModel parts using shared helper
					const outputParts = convertOutputsToLanguageModelParts(cellOutputs);
					resultParts.push(...outputParts);
				}
			}

			return new vscode.LanguageModelToolResult2(resultParts);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.RunNotebookCells, 'execute cells');
		}
	}
});

/**
 * Tool: Add Notebook Cell
 *
 * Adds a new cell (code or markdown) to the active notebook at the specified position.
 */
export const AddNotebookCellTool = vscode.lm.registerTool<{
	type: 'code' | 'markdown';
	index: number;
	content: string;
}>(PositronAssistantToolName.AddNotebookCell, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Adding notebook cell'),
			pastTenseMessage: vscode.l10n.t('Added notebook cell'),
		};
	},
	invoke: async (options, token) => {
		const { type, index, content } = options.input;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			// Handle append case (-1 means append at end)
			const insertIndex = index === -1 ? context.cellCount : index;

			// Convert string type to NotebookCellType enum
			const cellType = type === 'code'
				? positron.notebooks.NotebookCellType.Code
				: positron.notebooks.NotebookCellType.Markdown;

			const cellId = await positron.notebooks.addCell(
				context.uri,
				cellType,
				insertIndex,
				content
			);

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully added ${type} cell at index ${insertIndex}. Cell ID: ${cellId}`)
			]);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.AddNotebookCell, 'add cell');
		}
	}
});

/**
 * Tool: Update Notebook Cell
 *
 * Updates the content of an existing cell in the active notebook.
 */
export const UpdateNotebookCellTool = vscode.lm.registerTool<{
	cellId: string;
	content: string;
}>(PositronAssistantToolName.UpdateNotebookCell, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Updating notebook cell'),
			pastTenseMessage: vscode.l10n.t('Updated notebook cell'),
		};
	},
	invoke: async (options, token) => {
		const { cellId, content } = options.input;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			await positron.notebooks.updateCellContent(
				context.uri,
				cellId,
				content
			);

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Successfully updated cell ${cellId}`)
			]);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.UpdateNotebookCell, 'update cell');
		}
	}
});

/**
 * Tool: Get Cell Outputs
 *
 * Retrieves the outputs from a specific cell in the active notebook.
 * Supports both text and image outputs.
 */
export const GetCellOutputsTool = vscode.lm.registerTool<{
	cellId: string;
}>(PositronAssistantToolName.GetCellOutputs, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Getting cell outputs'),
			pastTenseMessage: vscode.l10n.t('Retrieved cell outputs'),
		};
	},
	invoke: async (options, token) => {
		const cellId = options.input.cellId;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			const outputs = await positron.notebooks.getCellOutputs(context.uri, cellId);

			if (outputs.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Cell ${cellId} has no outputs`)
				]);
			}

			// Convert outputs to mixed text/image parts using shared helper
			const resultParts = convertOutputsToLanguageModelParts(
				outputs,
				`Outputs for cell ${cellId}:\n\n`
			);

			return new vscode.LanguageModelToolResult2(resultParts);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.GetCellOutputs, 'get outputs');
		}
	}
});

/**
 * Tool: Get Notebook Cells
 *
 * Retrieves information about all cells or specific cells in the active notebook.
 */
export const GetNotebookCellsTool = vscode.lm.registerTool<{
	cellIds?: string[];
}>(PositronAssistantToolName.GetNotebookCells, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Getting notebook cells'),
			pastTenseMessage: vscode.l10n.t('Retrieved notebook cells'),
		};
	},
	invoke: async (options, token) => {
		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			// If specific cell IDs requested, fetch those cells
			if (options.input.cellIds && options.input.cellIds.length > 0) {
				const cells: positron.notebooks.NotebookCell[] = [];
				for (const cellId of options.input.cellIds) {
					const cell = await positron.notebooks.getCell(context.uri, cellId);
					if (cell) {
						cells.push(cell);
					}
				}

				if (cells.length === 0) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(`No cells found with the specified IDs`)
					]);
				}

				const cellInfo = formatCellsInfo(cells);

				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Retrieved ${cells.length} cell(s):\n\n${cellInfo}`)
				]);
			}

			// Otherwise, fetch all cells
			const cells = await positron.notebooks.getCells(context.uri);

			if (cells.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('The notebook has no cells')
				]);
			}

			const cellInfo = formatCellsInfo(cells);

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Retrieved all ${cells.length} cell(s) from notebook:\n\n${cellInfo}`)
			]);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.GetNotebookCells, 'get cells');
		}
	}
});

/**
 * Register all notebook tools with the extension context.
 *
 * This function should be called during extension activation to register
 * the notebook tools as disposables.
 *
 * @param context The extension context for registering disposables
 */
export function registerNotebookTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		RunNotebookCellsTool,
		AddNotebookCellTool,
		UpdateNotebookCellTool,
		GetCellOutputsTool,
		GetNotebookCellsTool
	);
}

