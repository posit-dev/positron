/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import init, { qmd_to_notebook, notebook_to_qmd } from 'wasm-positron-qmd-notebook';

export type CellKind = 'code' | 'markup';

export interface QuartoCellMetadata {
	type?: 'frontmatter';
	fenceLength?: number;
}

export interface NotebookCell {
	kind: CellKind;
	content: string;
	languageId: string;
	metadata?: {
		quarto?: QuartoCellMetadata;
	};
}

interface QmdToNotebookResponse {
	success: boolean;
	cells?: NotebookCell[];
	error?: string;
}

interface NotebookToQmdResponse {
	success: boolean;
	qmd?: string;
	error?: string;
}

export class QmdNotebookParser {
	private _initPromise: Promise<void> | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	async parse(content: string): Promise<NotebookCell[]> {
		await this.initialize();
		const jsonString = qmd_to_notebook(content);
		const response: QmdToNotebookResponse = JSON.parse(jsonString);
		if (!response.success) {
			throw new Error(response.error ?? 'Unknown parse error');
		}
		return response.cells ?? [];
	}

	async serialize(cells: NotebookCell[]): Promise<string> {
		await this.initialize();
		const input = JSON.stringify({ cells });
		const jsonString = notebook_to_qmd(input);
		const response: NotebookToQmdResponse = JSON.parse(jsonString);
		if (!response.success) {
			throw new Error(response.error ?? 'Unknown serialization error');
		}
		return response.qmd ?? '';
	}

	async initialize(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = (async () => {
				const wasmPath = vscode.Uri.joinPath(
					this._extensionUri,
					'node_modules', 'wasm-positron-qmd-notebook', 'wasm_positron_qmd_notebook_bg.wasm'
				);
				const wasmBytes = await vscode.workspace.fs.readFile(wasmPath);
				await init({ module_or_path: wasmBytes });
			})();
		}
		return this._initPromise;
	}
}
