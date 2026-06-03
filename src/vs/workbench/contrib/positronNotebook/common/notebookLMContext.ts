/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isTextStreamMime } from '../../../../base/common/mime.js';
import { CellKind, INotebookTextModel } from '../../notebook/common/notebookCommon.js';

export interface VariableSnapshot {
	name: string;
	type: string;
	typeInfo?: string;
}

export interface NotebookLMContextOptions {
	maxOutputLength?: number;
	maxPrevCellLength?: number;
	maxPreviousCells?: number;
	maxVariables?: number;
}

export interface NotebookLMContext {
	/** Render the context as the markdown block sent to the LM. */
	toMarkdown(): string;
}

const DEFAULT_MAX_OUTPUT_LENGTH = 1000;
const DEFAULT_MAX_PREV_CELL_LENGTH = 200;
const DEFAULT_MAX_PREVIOUS_CELLS = 3;
const DEFAULT_MAX_VARIABLES = 20;

/**
 * Build a structured notebook context snapshot for LLM consumption.
 * Throws if executedCellIndex is out of bounds.
 */
export function buildNotebookLMContext(
	notebook: INotebookTextModel,
	executedCellIndex: number,
	variables?: VariableSnapshot[],
	options?: NotebookLMContextOptions,
): NotebookLMContext {
	const cells = notebook.cells;
	if (executedCellIndex < 0 || executedCellIndex >= cells.length) {
		throw new Error(`executedCellIndex ${executedCellIndex} is out of bounds (notebook has ${cells.length} cells)`);
	}

	const maxOutputLength = options?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
	const maxPrevCellLength = options?.maxPrevCellLength ?? DEFAULT_MAX_PREV_CELL_LENGTH;
	const maxPreviousCells = options?.maxPreviousCells ?? DEFAULT_MAX_PREVIOUS_CELLS;
	const maxVariables = options?.maxVariables ?? DEFAULT_MAX_VARIABLES;

	const executedCell = cells[executedCellIndex];
	const language = executedCell.language;
	const cellPosition = `${executedCellIndex + 1} of ${cells.length}`;
	const hasError = hasErrorInOutputs(executedCell.outputs);
	const outputs = decodeCellOutputs(executedCell.outputs, maxOutputLength);
	const executedCellBlock = formatExecutedCell(executedCell);
	const previousCellsBlock = formatPreviousCells(cells, executedCellIndex, maxPreviousCells, maxPrevCellLength);
	const variablesBlock = variables ? selectAndFormatVariables(variables, maxVariables) : '';

	return {
		toMarkdown() {
			const parts: string[] = [];

			parts.push('## Notebook Context');
			parts.push(`- Language: ${language}`);
			parts.push(`- Cell position: ${cellPosition}`);
			parts.push(hasError
				? '- Status: Cell execution produced an error'
				: '- Status: Cell executed successfully');
			parts.push('');

			parts.push(`## Just Executed Cell (Cell ${executedCellIndex + 1})`);
			parts.push(executedCellBlock);
			parts.push('');

			if (outputs) {
				parts.push('## Cell Output');
				parts.push('```');
				parts.push(outputs);
				parts.push('```');
				parts.push('');
			}

			if (previousCellsBlock) {
				parts.push(previousCellsBlock);
				parts.push('');
			}

			if (variablesBlock) {
				parts.push('## Session Variables');
				parts.push('Variables currently defined in the runtime (name|type):');
				parts.push('```');
				parts.push(variablesBlock);
				parts.push('```');
				parts.push('');
			}

			return parts.join('\n') + '\n';
		}
	};
}

// --- Internal helpers (not exported) ---

function formatExecutedCell(cell: INotebookTextModel['cells'][number]): string {
	return '```' + cell.language + '\n' + cell.getValue() + '\n```';
}

/**
 * Outputs are concatenated into a single string. This is intentional: the
 * hasError boolean already signals error status to the model, and a traceback
 * is readable inline without structural separation between stdout and stderr.
 */
function decodeCellOutputs(outputs: INotebookTextModel['cells'][number]['outputs'], maxLength: number): string {
	const textParts: string[] = [];

	for (const output of outputs) {
		for (const item of output.outputs) {
			if (
				item.mime === 'text/plain' ||
				isTextStreamMime(item.mime)
			) {
				const text = item.data.toString();
				const truncated = text.length > maxLength
					? text.substring(0, maxLength) + '...'
					: text;
				textParts.push(truncated);
			} else if (item.mime === 'application/vnd.code.notebook.error') {
				try {
					const errorData = JSON.parse(item.data.toString());
					const errorText = errorData.stack || errorData.message || errorData.traceback?.join('\n') || item.data.toString();
					const truncated = errorText.length > maxLength
						? errorText.substring(0, maxLength) + '...'
						: errorText;
					textParts.push(truncated);
				} catch {
					const text = item.data.toString();
					const truncated = text.length > maxLength
						? text.substring(0, maxLength) + '...'
						: text;
					textParts.push(truncated);
				}
			}
		}
	}

	return textParts.join('\n');
}

function hasErrorInOutputs(outputs: INotebookTextModel['cells'][number]['outputs']): boolean {
	for (const output of outputs) {
		for (const item of output.outputs) {
			if (
				item.mime === 'application/vnd.code.notebook.error' ||
				item.mime === 'application/vnd.code.notebook.stderr'
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Scan backwards from executedCellIndex collecting code cells (skipping
 * markdown) until `count` code cells are found or the beginning is reached.
 */
function formatPreviousCells(
	cells: INotebookTextModel['cells'],
	executedCellIndex: number,
	count: number,
	maxLength: number,
): string {
	const codeCells: Array<{ index: number; cell: INotebookTextModel['cells'][number] }> = [];

	for (let i = executedCellIndex - 1; i >= 0 && codeCells.length < count; i--) {
		if (cells[i].cellKind === CellKind.Code) {
			codeCells.unshift({ index: i, cell: cells[i] });
		}
	}

	if (codeCells.length === 0) {
		return '';
	}

	const parts: string[] = [];
	parts.push(`## Previous Context (last ${codeCells.length} cells)`);
	for (const { index, cell } of codeCells) {
		const content = cell.getValue();
		const truncated = content.length > maxLength
			? content.substring(0, maxLength) + '...'
			: content;
		parts.push(`Cell ${index + 1}:`);
		parts.push('```' + cell.language);
		parts.push(truncated);
		parts.push('```');
	}

	return parts.join('\n');
}

function getVariablePriority(type: string): number {
	const t = type.toLowerCase();

	const tableTypes = ['dataframe', 'data.frame', 'tibble', 'series', 'matrix', 'array', 'ndarray'];
	if (tableTypes.some(tt => t.includes(tt))) {
		return 1;
	}

	const collectionTypes = ['list', 'dict', 'set', 'tuple', 'vector', 'environment'];
	if (collectionTypes.some(ct => t.includes(ct))) {
		return 2;
	}

	const scalarTypes = ['int', 'float', 'str', 'bool', 'numeric', 'character', 'logical', 'complex', 'double'];
	if (scalarTypes.some(st => t.includes(st))) {
		return 3;
	}

	return 4;
}

function selectAndFormatVariables(variables: VariableSnapshot[], maxCount: number): string {
	if (variables.length === 0) {
		return '';
	}

	const sorted = [...variables].sort(
		(a, b) => getVariablePriority(a.type) - getVariablePriority(b.type)
	);
	const selected = sorted.slice(0, maxCount);

	return selected.map(v =>
		v.typeInfo ? `${v.name}|${v.type}|${v.typeInfo}` : `${v.name}|${v.type}`
	).join('\n');
}
