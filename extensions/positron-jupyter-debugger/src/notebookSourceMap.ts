/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DisposableStore } from './util.js';

export class NotebookSourceMap implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private _runtimeSourcePathToCellUri = new Map<string, string>();
	private _cellUriToRuntimeSourcePath = new Map<string, string>();

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		this._disposables.add(this._adapter.onDidUpdateSourceMapOptions(() => {
			this.refresh();
		}));

		if (this._adapter.sourceMapOptions) {
			this.refresh();
		}

		this._disposables.add(vscode.workspace.onDidChangeNotebookDocument(event => {
			if (event.notebook.uri.toString() !== this._notebook.uri.toString()) {
				return;
			}
			// TODO: Probably need to throttle some of these?
			for (const change of event.contentChanges) {
				for (const cell of change.addedCells) {
					this.add(cell);
				}
				for (const cell of change.removedCells) {
					this.delete(cell);
				}
			}
			for (const change of event.cellChanges) {
				this.add(change.cell);
			}
		}));
	}

	public runtimeToClientSourcePath(runtimeSourcePath: string): string | undefined {
		return this._runtimeSourcePathToCellUri.get(runtimeSourcePath);
	}

	public clientToRuntimeSourcePath(clientSourcePath: string): string | undefined {
		return this._cellUriToRuntimeSourcePath.get(clientSourcePath);
	}

	private clear(): void {
		this._runtimeSourcePathToCellUri.clear();
		this._cellUriToRuntimeSourcePath.clear();
	}

	private add(cell: vscode.NotebookCell): void {
		const cellUri = cell.document.uri.toString();
		const code = cell.document.getText();
		const sourcePath = this._adapter.getRuntimeSourcePath(code);
		this._runtimeSourcePathToCellUri.set(sourcePath, cellUri);
		this._cellUriToRuntimeSourcePath.set(cellUri, sourcePath);
	}

	private delete(cell: vscode.NotebookCell): void {
		const cellUri = cell.document.uri.toString();
		const sourcePath = this._cellUriToRuntimeSourcePath.get(cellUri);
		if (sourcePath) {
			this._runtimeSourcePathToCellUri.delete(sourcePath);
			this._cellUriToRuntimeSourcePath.delete(cellUri);
		}
	}

	private refresh(): void {
		this.clear();
		for (const cell of this._notebook.getCells()) {
			this.add(cell);
		}
	}

	private get log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
