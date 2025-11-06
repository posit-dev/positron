/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';

/**
 * Formats cell status information into a readable string.
 * @param cell The cell to format status for
 * @returns Formatted status string
 */
function formatCellStatus(cell: positron.notebooks.NotebookCell): string {
	const statusParts: string[] = [];
	statusParts.push(`Selection: ${cell.selectionStatus}`);
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
	statusParts.push(cell.hasOutput ? 'Has output' : 'No output');
	return statusParts.join(' | ');
}

/**
 * Tool: Run Notebook Cells
 *
 * Executes one or more cells in the active notebook and returns their outputs.
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
			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active notebook found')
				]);
			}

			await positron.notebooks.runCells(context.uri, cellIds);

			// Get outputs for each cell
			const outputs: string[] = [];
			for (const cellId of cellIds) {
				const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, cellId);
				if (cellOutputs.length > 0) {
					outputs.push(`Cell ${cellId}:\n${cellOutputs.join('\n')}`);
				}
			}

			const outputText = outputs.length > 0
				? `Successfully executed ${cellIds.length} cell(s).\n\nOutputs:\n${outputs.join('\n\n')}`
				: `Successfully executed ${cellIds.length} cell(s).`;

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(outputText)
			]);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`[${PositronAssistantToolName.RunNotebookCells}] Failed to execute cells: ${errorMessage}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to execute cells: ${errorMessage}`)
			]);
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
			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active notebook found')
				]);
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
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`[${PositronAssistantToolName.AddNotebookCell}] Failed to add cell: ${errorMessage}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to add cell: ${errorMessage}`)
			]);
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
			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active notebook found')
				]);
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
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`[${PositronAssistantToolName.UpdateNotebookCell}] Failed to update cell: ${errorMessage}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to update cell: ${errorMessage}`)
			]);
		}
	}
});

/**
 * Tool: Get Cell Outputs
 *
 * Retrieves the outputs from a specific cell in the active notebook.
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
			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active notebook found')
				]);
			}

			const outputs = await positron.notebooks.getCellOutputs(context.uri, cellId);

			if (outputs.length === 0) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(`Cell ${cellId} has no outputs`)
				]);
			}

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Outputs for cell ${cellId}:\n\n${outputs.join('\n\n')}`)
			]);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`[${PositronAssistantToolName.GetCellOutputs}] Failed to get outputs: ${errorMessage}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to get outputs: ${errorMessage}`)
			]);
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
			const context = await positron.notebooks.getContext();
			if (!context) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('No active notebook found')
				]);
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

				const cellInfo = cells.map(cell => {
					const statusInfo = formatCellStatus(cell);
					return `### Cell ${cell.index} (${cell.type})
ID: ${cell.id}
Status: ${statusInfo}
\`\`\`
${cell.content}
\`\`\``;
				}).join('\n\n');

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

			const cellInfo = cells.map(cell => {
				const statusInfo = formatCellStatus(cell);
				return `### Cell ${cell.index} (${cell.type})
ID: ${cell.id}
Status: ${statusInfo}
\`\`\`
${cell.content}
\`\`\``;
			}).join('\n\n');

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Retrieved all ${cells.length} cell(s) from notebook:\n\n${cellInfo}`)
			]);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`[${PositronAssistantToolName.GetNotebookCells}] Failed to get cells: ${errorMessage}`);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Failed to get cells: ${errorMessage}`)
			]);
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

