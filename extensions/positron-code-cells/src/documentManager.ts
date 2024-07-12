/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { trace } from './logging';
import { Cell, CellParser, getParser, parseCells, supportedLanguageIds } from './parser';
import { IGNORED_SCHEMES } from './extension';

// List of opened documents
// export const documentManagers: DocumentManager[] = [];
const documentManagers: Map<vscode.Uri, DocumentManager> = new Map();


export interface ExecuteCode {
	(language: string, code: string): Promise<void>;
}
const defaultExecuteCode: ExecuteCode = async (language, code) => {
	await positron.runtime.executeCode(language, code, false, true);
};

// Provides a set of commands for interacting with Jupyter-like cells in a vscode.TextEditor
export class DocumentManager implements vscode.Disposable {
	private cells: Cell[] = [];
	private parser: CellParser;
	private document: vscode.TextDocument;

	constructor(
		private editor: vscode.TextEditor,
		private readonly executeCode: ExecuteCode = defaultExecuteCode,
	) {
		this.document = this.editor.document;
		const parser = getParser(this.document.languageId);
		if (!parser) {
			throw new Error(`Code cells not configured for language ${this.document.languageId}`);
		}
		this.parser = parser;

		documentManagers.set(this.document.uri, this);
		trace(`Constructing document manager for:\nURI: ${this.document.uri}\nlanguage: ${this.document.languageId}\n`);
	}

	public dispose() {
		documentManagers.delete(this.document.uri);
	}

	public parseCells() {
		this.cells = parseCells(this.document);
	}

	public getCells() {
		return this.cells;
	}

	public getDocument() {
		return this.document;
	}

	//
	private getCursor(line?: number): vscode.Position {
		if (line !== undefined) {
			return new vscode.Position(line, 0);
		}
		return this.editor.selection.active;
	}

	private getCurrentCellIndex(line?: number): number {
		const cursor = this.getCursor(line);
		return this.cells.findIndex(cell => cell.range.contains(cursor));
	}

	private getCurrentCell(line?: number): Cell | undefined {
		return this.cells[this.getCurrentCellIndex(line)];
	}

	private getPreviousCell(line?: number): Cell | undefined {
		const cursor = this.getCursor(line);
		const index = this.getCurrentCellIndex(cursor.line);
		if (index !== -1) {
			if (index === 0) {
				return undefined;
			}
			return this.cells[index - 1];
		} else {
			// If we weren't inside a cell, find the first cell after the cursor.
			return this.cells.find(cell => cell.range.end.isAfter(cursor));
		}
	}

	private getNextCell(line?: number): Cell | undefined {
		const cursor = this.getCursor(line);
		if (!cursor) { return; }

		const index = this.getCurrentCellIndex(cursor.line);
		if (index !== -1) {
			if (index === this.cells.length) {
				return undefined;
			}
			return this.cells[index + 1];
		} else {
			// If we weren't inside a cell, find the first cell after the cursor.
			return this.cells.find(cell => cell.range.end.isAfter(cursor));
		}
	}

	private goToCell(cell: Cell): void {
		// Skip the cell marker line
		const line = Math.min(cell.range.start.line + 1, cell.range.end.line);
		const cursor = new vscode.Position(line, 0);
		this.editor.selection = new vscode.Selection(cursor, cursor);
		this.editor.revealRange(cell.range);
	}

	private runCell(cell: Cell): void {
		if (!this.parser) {
			return;
		}
		const text = this.parser.getCellText(cell, this.document);
		this.executeCode(this.document.languageId, text);
	}

	// Public commands
	public runAllCells(): void {
		for (const cell of this.cells) {
			this.runCell(cell);
		}
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
		for (let i = 0; i < end; i++) {
			this.runCell(this.cells[i]);
		}
	}

	public runCurrentAndBelow(line?: number): void {
		const start = this.getCurrentCellIndex(line);
		for (let i = start; i < this.cells.length; i++) {
			this.runCell(this.cells[i]);
		}
	}

	public runCellsBelow(line?: number): void {
		const start = this.getCurrentCellIndex(line);
		for (let i = start + 1; i < this.cells.length; i++) {
			this.runCell(this.cells[i]);
		}
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
		await this.editor.edit(editBuilder => {
			editBuilder.insert(location, getParser(this.document.languageId)?.newCell() ?? '');
		});
		this.goToNextCell(location.line);
	}
}

export function canHaveCells(document: vscode.TextDocument) {
	return !IGNORED_SCHEMES.includes(document.uri.scheme) && supportedLanguageIds.includes(document.languageId);
}

export function reparseDocument(editor: vscode.TextEditor | undefined) {
	if (editor && canHaveCells(editor.document)) {
		documentManagers.get(editor.document.uri)?.parseCells();
	}
}

export function getOrCreateDocumentManager(editor: vscode.TextEditor) {
	let docManager = documentManagers.get(editor.document.uri);
	if (!docManager) {
		docManager = new DocumentManager(editor);
		docManager.parseCells();
	}
	return docManager;
}

// Creates documentManager and parses cells, if needed
export function setupDocumentManager(editor: vscode.TextEditor | undefined) {
	if (editor && canHaveCells(editor.document)) {
		getOrCreateDocumentManager(editor);
	}
}

export function getActiveDocumentManager(): DocumentManager | undefined {
	const activeEditor = vscode.window?.activeTextEditor;
	if (activeEditor && canHaveCells(activeEditor.document)) {
		return getOrCreateDocumentManager(activeEditor);
	}

	return undefined;
}

export function getEditorFromDocument(document: vscode.TextDocument): vscode.TextEditor | undefined {
	return vscode.window.visibleTextEditors.find(
		(editor) => editor.document === document
	);
}

export function activateDocumentManagers(disposables: vscode.Disposable[]): void {
	// When starting extension, fill documentManagers
	vscode.window.visibleTextEditors.forEach((editor) => {
		setupDocumentManager(editor);
	});

	disposables.push(
		// When opening file, create new document
		vscode.workspace.onDidOpenTextDocument(document => {
			setupDocumentManager(getEditorFromDocument(document));
		}),

		// When closing file, destroy that document manager
		vscode.workspace.onDidCloseTextDocument(document => {
			documentManagers.get(document.uri)?.dispose();
		}),

		// Trigger a decorations update when the active editor's content changes.
		vscode.workspace.onDidChangeTextDocument(event => {
			reparseDocument(getEditorFromDocument(event.document));
		})
	);
}



