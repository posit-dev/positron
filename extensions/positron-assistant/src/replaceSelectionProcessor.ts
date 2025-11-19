/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { DefaultTextProcessor } from './defaultTextProcessor.js';

/** A streaming tag processor that handles selection replacement operations. */
export class ReplaceSelectionProcessor {
	private readonly _lexer: StreamingTagLexer<string>;

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
		private readonly _defaultTextProcessor?: DefaultTextProcessor,
	) {
		this._lexer = new StreamingTagLexer({
			tagNames: ['replaceSelection'],
			contentHandler: async (chunk) => {
				await this.processChunk(chunk);
			}
		});
	}

	async process(text: string): Promise<void> {
		await this._lexer.process(text);
	}

	async flush(): Promise<void> {
		await this._lexer.flush();
		// Also flush the default text processor if available
		if (this._defaultTextProcessor) {
			await this._defaultTextProcessor.flush();
		}
	}

	private async processChunk(chunk: any): Promise<void> {
		// Proceed through the states in the expected order.
		// NOTE: This does not currently handle unexpected or out-of-order tags.
		switch (this._state) {
			case 'pending_replaceSelection_open': {
				if (chunk.type === 'text') {
					await this.onPlainText(chunk.text);
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

	private async onPlainText(text: string): Promise<void> {
		// Outside of a replaceSelection tag, delegate to the default text processor if available
		if (this._defaultTextProcessor) {
			await this._defaultTextProcessor.process(text);
		} else {
			// Fallback to treating it as markdown
			this._response.markdown(text);
		}
	}

	private onReplaceSelectionText(text: string): void {
		// When we receive the first chunk, delete the selection.
		if (!this._didDeleteSelection) {
			this._response.textEdit(this._uri, vscode.TextEdit.delete(this._selection));
			this._didDeleteSelection = true;

			// Update the insert position to the start of the removed text.
			this._insertPosition = this._selection.start;
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
