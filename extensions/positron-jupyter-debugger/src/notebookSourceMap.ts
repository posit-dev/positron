/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DisposableStore } from './util.js';

export class NotebookSourceMap implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private _runtimeToClientSourcePath = new Map<string, string>();
	private _clientToRuntimeSourcePath = new Map<string, string>();

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		this._disposables.add(this._adapter.onDidUpdateSourceMapOptions(() => {
			this.updateSourceMaps();
		}));
		if (this._adapter.sourceMapOptions) {
			this.updateSourceMaps();
		}
	}

	public runtimeToClientSourcePath(runtimeSourcePath: string): string | undefined {
		return this._runtimeToClientSourcePath.get(runtimeSourcePath);
	}

	public clientToRuntimeSourcePath(clientSourcePath: string): string | undefined {
		return this._clientToRuntimeSourcePath.get(clientSourcePath);
	}

	private updateSourceMaps(): void {
		// TODO: Block debugging until this is done?
		// TODO: Update the map when a cell's source changes.
		this._runtimeToClientSourcePath.clear();
		this._clientToRuntimeSourcePath.clear();
		for (const cell of this._notebook.getCells()) {
			const cellUri = cell.document.uri.toString();
			const code = cell.document.getText();
			const sourcePath = this._adapter.getRuntimeSourcePath(code);
			this._runtimeToClientSourcePath.set(sourcePath, cellUri);
			this._clientToRuntimeSourcePath.set(cellUri, sourcePath);
		}
	}

	private get log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
