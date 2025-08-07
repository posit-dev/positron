/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { PathEncoder } from './pathEncoder.js';
import { DisposableStore } from './util.js';
import { SourceLocation } from './debugProtocolTransformer.js';
import { LocationMapper } from './jupyterRuntimeDebugAdapter.js';

export class NotebookLocationMapper implements vscode.Disposable, LocationMapper {
	private readonly _disposables = new DisposableStore();
	private _runtimeSourcePathToCellUri = new Map<string, string>();
	private _cellUriToRuntimeSourcePath = new Map<string, string>();

	constructor(
		private readonly _sourceMapper: PathEncoder,
		private readonly _notebook: vscode.NotebookDocument
	) {
		this.refresh();

		this._disposables.add(this._sourceMapper.onDidUpdateOptions(() => {
			this.refresh();
		}));

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

	public toClientLocation<T extends SourceLocation>(location: T): T {
		const cellUri = location.source?.path && this._runtimeSourcePathToCellUri.get(location.source.path);
		if (!cellUri) {
			return location;
		}
		return {
			...location,
			source: {
				...location.source,
				sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
				path: cellUri,
			},
		};
	}

	public toRuntimeLocation<T extends SourceLocation>(location: T): T {
		const path = location.source?.path && this._cellUriToRuntimeSourcePath.get(location.source.path);
		if (!path) {
			return location;
		}
		return {
			...location,
			source: {
				...location.source,
				path,
			},
		};
	}

	private clear(): void {
		this._runtimeSourcePathToCellUri.clear();
		this._cellUriToRuntimeSourcePath.clear();
	}

	private add(cell: vscode.NotebookCell): void {
		const cellUri = cell.document.uri.toString();
		const code = cell.document.getText();
		const sourcePath = this._sourceMapper.encode(code);
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

	dispose(): void {
		this._disposables.dispose();
	}
}
