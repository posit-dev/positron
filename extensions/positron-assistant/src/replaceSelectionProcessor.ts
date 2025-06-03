/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Chunk } from './streamingTagLexer.js';

export type ReplaceSelectionTag = typeof ReplaceSelectionProcessor.TagNames[number];

/** A streaming tag processor that handles selection replacement operations. */
export class ReplaceSelectionProcessor {
	/** The names of the tags that this processor can handle. */
	public static readonly TagNames = ['replaceSelection'] as const;

	/** The current state of the processor. */
	private _state:
		'pending_replaceSelection_open' |
		'pending_replaceSelection_close' = 'pending_replaceSelection_open';

	/** Has the selection been deleted? */
	private _didDeleteSelection = false;

	/**
	 * As each edit is applied, the insert position will be moved to the end of the edited text
	 * for the next iteration.
	 */
	private _insertPosition?: vscode.Position;

	constructor(
		private readonly _uri: vscode.Uri,
		private readonly _selection: vscode.Selection,
		private readonly _response: vscode.ChatResponseStream,
	) { }

	process(chunk: Chunk<ReplaceSelectionTag>): void {
		// Proceed through the states in the expected order.
		// NOTE: This does not currently handle unexpected or out-of-order tags.
		switch (this._state) {
			case 'pending_replaceSelection_open': {
				if (chunk.type === 'text') {
					this.onPlainText(chunk.text);
				} else if (chunk.type === 'tag' && chunk.kind === 'open' && chunk.name === 'replaceSelection') {
					this._state = 'pending_replaceSelection_close';
				}
				break;
			}
			case 'pending_replaceSelection_close': {
				if (chunk.type === 'text') {
					this.onReplaceSelectionText(chunk.text);
				} else if (chunk.type === 'tag' && chunk.kind === 'close' && chunk.name === 'replaceSelection') {
					this.onReplaceSelectionClose();
					this._state = 'pending_replaceSelection_open';
				}
				break;
			}
		}
	}

	private onPlainText(text: string): void {
		// Outside of a replaceSelection tag, just treat it as markdown.
		this._response.markdown(text);
	}

	private onReplaceSelectionText(text: string): void {
		// When we receive the first chunk, delete the selection.
		if (!this._didDeleteSelection) {
			this._response.textEdit(this._uri, vscode.TextEdit.delete(this._selection));
			this._didDeleteSelection = true;

			// Update the insert position to the end of the deleted text.
			this._insertPosition = this._selection.anchor;
		}

		// Insert the new chunk at the start of the selection.
		this._response.textEdit(this._uri, vscode.TextEdit.insert(this._insertPosition!, text));

		// Move the insert position to the end of the inserted text.
		const lines = text.split(/\r?\n/);
		const lineDelta = lines.length - 1;
		const characterDelta = lines.at(-1)!.length;
		this._insertPosition = this._insertPosition!.translate(lineDelta, characterDelta);
	}

	private onReplaceSelectionClose(): void {
		// Reset the deletion state for the next use.
		this._didDeleteSelection = false;
	}
}
