/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { Cell, CellParser, getParser, parseCells } from './parser';

export interface ExecuteCode {
	(language: string, code: string): Promise<void>;
}

const defaultExecuteCode: ExecuteCode = async (language, code) => {
	await positron.runtime.executeCode(language, code, false);
};

// Provides a set of commands for interacting with Jupyter-like cells in a vscode.TextEditor
export class CellManager {
	private cells: Cell[];
	private parser: CellParser;

	constructor(
		private editor: vscode.TextEditor,
		private readonly executeCode: ExecuteCode = defaultExecuteCode,
	) {
		this.cells = [];
		this.parseCells();

		const parser = getParser(this.editor.document.languageId);
		if (!parser) {
			throw new Error(`Code cells not configured for language ${this.editor.document.languageId}`);
		}
		this.parser = parser;
	}

	private parseCells(): void {
		this.cells = parseCells(this.editor.document);
	}

	private getCursor(line?: number): vscode.Position {
		return line !== undefined ? new vscode.Position(line, 0) : this.editor.selection.active;
	}

	private getCurrentCellIndex(line?: number): number {
		return this.cells.findIndex(cell => cell.range.contains(this.getCursor(line)));
	}

	private getCurrentCell(line?: number): Cell | undefined {
		return this.cells[this.getCurrentCellIndex(line)];
	}

	private getPreviousCell(line?: number): Cell | undefined {
		const index = this.getCurrentCellIndex(line);
		if (index !== -1) {
			return this.cells[index - 1];
		} else {
			// If we weren't inside a cell, find the last cell before the cursor.
			return this.cells.reverse().find(cell => cell.range.end.isBefore(this.getCursor(line)));
		}
	}

	private getNextCell(line?: number): Cell | undefined {
		const index = this.getCurrentCellIndex(line);
		if (index !== -1) {
			return this.cells[index + 1];
		} else {
			// If we weren't inside a cell, find the first cell after the cursor.
			return this.cells.find(cell => cell.range.end.isAfter(this.getCursor(line)));
		}
	}

	private runCell(cell: Cell): void {
		const text = this.parser.getCellText(cell, this.editor.document);
		this.executeCode(this.editor.document.languageId, text);
	}

	public runCurrentCell(line?: number): void {
		const cell = this.getCurrentCell(line);
		if (cell) {
			this.runCell(cell);
		}
	}

	public runCurrentAdvance(line?: number): void {
		this.runCurrentCell(line);
		this.goToNextCell(line);
	}

	public runPreviousCell(line?: number): void {
		const cell = this.getPreviousCell(line);
		if (cell) {
			this.runCell(cell);
			this.goToPreviousCell(line);
		}
	}

	public runNextCell(line?: number): void {
		const cell = this.getNextCell(line);
		if (cell) {
			this.runCell(cell);
			this.goToNextCell(line);
		}
	}

	public runCellsAbove(line?: number): void {
		const end = this.getCurrentCellIndex(line);
		for (const cell of this.cells.slice(0, end)) {
			this.runCell(cell);
		}
	}

	public runCellsBelow(line?: number): void {
		const start = this.getCurrentCellIndex(line) + 1;
		for (const cell of this.cells.slice(start)) {
			this.runCell(cell);
		}
	}

	public runAllCells(): void {
		for (const cell of this.cells) {
			this.runCell(cell);
		}
	}

	private goToCell(cell: Cell): void {
		// Skip the cell marker line
		const line = Math.min(cell.range.start.line + 1, cell.range.end.line);
		const cursor = new vscode.Position(line, 0);
		this.editor.selection = new vscode.Selection(cursor, cursor);
		this.editor.revealRange(cell.range);
	}

	public goToPreviousCell(line?: number): void {
		const cell = this.getPreviousCell(line);
		if (cell) {
			this.goToCell(cell);
		}
	}

	public goToNextCell(line?: number): void {
		const cell = this.getNextCell(line);
		if (cell) {
			this.goToCell(cell);
		}
	}

	public async insertCodeCell(line?: number): Promise<void> {
		const location = this.getCurrentCell(line)?.range.end ?? this.editor.selection.active;
		await this.editor.edit(editBuilder => { editBuilder.insert(location, this.parser.newCell()); });
		this.parseCells();
		this.goToNextCell(location.line);
	}

	public static fromActiveTextEditor(): CellManager | undefined {
		const editor = vscode.window.activeTextEditor;
		return editor && new CellManager(editor);
	}
}
