/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { PathEncoder } from './pathEncoder.js';
import { Disposable } from './util.js';
import { Location, LocationMapper } from './locationMapper.js';

/**
 * Maps source locations between notebook cells and runtime source paths.
 */
export class NotebookLocationMapper extends Disposable implements LocationMapper {

	/* Map of cell URI keyed by runtime source path. */
	private _cellUriByRuntimeSourcePath = new Map<string, string>();

	/* Map of runtime source path keyed by cell URI. */
	private _runtimeSourcePathByCellUri = new Map<string, string>();

	constructor(
		private readonly _pathEncoder: PathEncoder,
		private readonly _notebook: vscode.NotebookDocument
	) {
		super();

		// Initial refresh for this notebook.
		if (this._pathEncoder.isInitialized()) {
			this.refresh();
		}

		// When the path encoder options change, refresh.
		this._register(this._pathEncoder.onDidUpdateOptions(() => {
			this.refresh();
		}));
	}

	/**
	 * Translates a runtime location to a client location.
	 * @param location The runtime location.
	 * @returns The client location (cell URI).
	 */
	public toClientLocation<T extends Location>(location: T): T {
		const cellUri = location.source?.path && this._cellUriByRuntimeSourcePath.get(location.source.path);
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

	/**
	 * Translates a client location (cell URI) to a runtime location.
	 * @param location The client location (cell URI).
	 * @returns The runtime location.
	 */
	public toRuntimeLocation<T extends Location>(location: T): T {
		const path = location.source?.path && this._runtimeSourcePathByCellUri.get(location.source.path);
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

	/* Clears all location maps. */
	private clear(): void {
		this._cellUriByRuntimeSourcePath.clear();
		this._runtimeSourcePathByCellUri.clear();
	}

	/* Adds or updates maps for a notebook cell. */
	private add(cell: vscode.NotebookCell): void {
		const cellUri = cell.document.uri.toString();
		const code = cell.document.getText();
		const sourcePath = this._pathEncoder.encode(code);
		this._cellUriByRuntimeSourcePath.set(sourcePath, cellUri);
		this._runtimeSourcePathByCellUri.set(cellUri, sourcePath);
	}

	/* Removes entries for a notebook cell. */
	private delete(cell: vscode.NotebookCell): void {
		const cellUri = cell.document.uri.toString();
		const sourcePath = this._runtimeSourcePathByCellUri.get(cellUri);
		if (sourcePath) {
			this._cellUriByRuntimeSourcePath.delete(sourcePath);
			this._runtimeSourcePathByCellUri.delete(cellUri);
		}
	}

	/* Rebuilds all entries from current notebook state. */
	private refresh(): void {
		this.clear();
		for (const cell of this._notebook.getCells()) {
			this.add(cell);
		}
	}
}
