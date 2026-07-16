/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { NotebookExporter, NotebookExportExtension } from './positron-notebook-export.js';
import { Disposable } from './util/disposable.js';

export class NotebookExportExtensionImpl extends Disposable implements NotebookExportExtension {
	private readonly _exporters: NotebookExporter[] = [];

	get exporters(): readonly NotebookExporter[] {
		return this._exporters;
	}

	registerNotebookExporter(exporter: NotebookExporter): vscode.Disposable {
		if (this.isDisposed) {
			throw new Error('Cannot register notebook exporter; the extension is deactivated.');
		}
		this._exporters.push(exporter);
		return this._register({
			dispose: () => {
				const index = this._exporters.indexOf(exporter);
				if (index !== -1) {
					this._exporters.splice(index, 1);
				}
			}
		});
	}
}
