/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NotebookExporter } from './positron-notebook-export.js';

type PercentCellType = 'code' | 'markdown' | 'raw';

/**
 * Options for exporting a notebook to the percent script format.
 */
interface PercentExportOptions {
	/**
	 * The comment prefix to use for markdown and raw cells.
	 * Added to each line of markdown and raw cells in the exported script.
	 */
	commentPrefix: string;
}

/**
 * A notebook exporter for the language-agnostic percent script format (e.g. `# %%`).
 *
 * See {@link https://jupytext.org/formats/scripts/} for more details on the format.
 */
abstract class PercentNotebookExporter implements Partial<NotebookExporter> {
	abstract supportedLanguageId: string;

	abstract options: PercentExportOptions;

	async export(notebook: vscode.NotebookDocument): Promise<void> {
		const content = notebookToPercentScript(notebook, this.options);
		const doc = await vscode.workspace.openTextDocument({
			content,
			language: this.supportedLanguageId
		});
		await vscode.window.showTextDocument(doc);
	}
}

/**
 * A notebook exporter for the percent script format for R notebooks.
 */
export class RPercentNotebookExporter extends PercentNotebookExporter implements NotebookExporter {
	label = 'R';
	fileExtension = '.R';
	supportedLanguageId = 'r';
	options = { commentPrefix: '#' };
}

/**
 * A notebook exporter for the percent script format for Python notebooks.
 */
export class PythonPercentNotebookExporter extends PercentNotebookExporter implements NotebookExporter {
	label = 'Python';
	fileExtension = '.py';
	supportedLanguageId = 'python';
	options = { commentPrefix: '#' };
}

/**
 * Export a notebook to the percent script format.
 */
export function notebookToPercentScript(
	notebook: vscode.NotebookDocument,
	options: PercentExportOptions,
): string {
	return notebook.getCells()
		.map(cell => cellToPercentScript(cell, options))
		.join('\n\n') + '\n';
}

function cellToPercentScript(
	cell: vscode.NotebookCell,
	options: PercentExportOptions
): string {
	if (cell.kind === vscode.NotebookCellKind.Markup) {
		return formatPercentCell(cell.document.getText(), 'markdown', options);
	} else if (
		cell.kind === vscode.NotebookCellKind.Code &&
		cell.document.languageId === 'raw'
	) {
		return formatPercentCell(cell.document.getText(), 'raw', options);
	} else {
		return formatPercentCell(cell.document.getText(), 'code', options);
	}
}

function formatPercentCell(
	text: string,
	type: PercentCellType,
	options: PercentExportOptions
): string {
	return `${formatPercentCellDelimiter(type, options)}
${formatPercentCellText(text, type, options)}`;
}

function formatPercentCellDelimiter(
	type: PercentCellType,
	{ commentPrefix }: PercentExportOptions
): string {
	return prefixLine(
		`%%${formatPercentCellType(type)}`,
		commentPrefix
	);
}

function formatPercentCellType(type: PercentCellType): string {
	return type === 'code' ? '' : ` [${type}]`;
}

function formatPercentCellText(
	text: string,
	type: PercentCellType,
	{ commentPrefix }: PercentExportOptions
): string {
	if (type === 'code') {
		return text;
	}
	return prefixLines(text, commentPrefix);
}

function prefixLines(text: string, prefix: string): string {
	return text
		.split('\n')
		.map((line) => prefixLine(line, prefix))
		.join('\n');
}

function prefixLine(line: string, prefix: string): string {
	return line.length > 0 ? `${prefix} ${line}` : prefix;
}
