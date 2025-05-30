/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TextProcessor } from './participants.js';

/** A streaming text processor for editing a selection. */
export class EditSelectionProcessor implements TextProcessor {
	/** Has the selection been deleted? */
	private _didDeleteSelection = false;

	constructor(
		private readonly uri: vscode.Uri,
		private readonly selection: vscode.Selection,
		private readonly response: vscode.ChatResponseStream,
	) { }

	process(chunk: string): void {
		// When we receive the first chunk, delete the selection.
		if (!this._didDeleteSelection) {
			this.response.textEdit(this.uri, vscode.TextEdit.delete(this.selection));
			this._didDeleteSelection = true;
		}

		// Insert the new chunk at the start of the selection.
		this.response.textEdit(this.uri, vscode.TextEdit.insert(this.selection.anchor, chunk));
	}

	flush(): void {
		// No-op
	}
}
