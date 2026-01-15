/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import init, { parse_qmd } from 'wasm-qmd-parser';
import { QmdDocument } from './ast.js';

/**
 * QMD parser wrapper.
 */
export class QmdParser {
	private _initPromise: Promise<void> | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	/**
	 * Parse QMD content. Lazily initializes the WASM module on first call.
	 * @param content QMD content to parse.
	 * @returns Parsed QMD document.
	 */
	async parse(content: string, includeSourceLocations = true): Promise<QmdDocument> {
		await this.initialize();
		const jsonString = parse_qmd(content, includeSourceLocations ? 'true' : 'false');
		return JSON.parse(jsonString);
	}

	/**
	 * Initialize the parser.
	 * @returns Promise that resolves when the parser is initialized.
	 */
	async initialize(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = (async () => {
				// Load WASM file using the module content -- couldn't get it to work otherwise
				const wasmPath = vscode.Uri.joinPath(
					this._extensionUri,
					'node_modules', 'wasm-qmd-parser', 'wasm_qmd_parser_bg.wasm'
				);
				const wasmBytes = await vscode.workspace.fs.readFile(wasmPath);
				await init({ module_or_path: wasmBytes });
			})();
		}
		return this._initPromise;
	}
}
