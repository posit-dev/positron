/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { DefaultTextProcessor } from './defaultTextProcessor.js';

/**
 * A streaming tag processor that handles string replacement operations.
 */
export class ReplaceStringProcessor {
	private readonly _lexer: StreamingTagLexer<string>;

	/** The current state of the processor. */
	private _state:
		'pending_replaceString_open' |
		'pending_old_open' |
		'pending_old_close' |
		'pending_new_open' |
		'pending_new_close' |
		'pending_replaceString_close' = 'pending_replaceString_open';

	/** The buffer for the old text to be replaced. */
	private _oldTextBuffer = '';

	/**
	 * As each edit is applied, the insert position will be moved to the end of the edited text
	 * for the next iteration.
	 */
	private _insertPosition?: vscode.Position;

	constructor(
		private readonly _document: vscode.TextDocument,
		private readonly _response: vscode.ChatResponseStream,
		private readonly _defaultTextProcessor?: DefaultTextProcessor,
	) {
		this._lexer = new StreamingTagLexer({
			tagNames: ['replaceString', 'old', 'new'],
			contentHandler: (chunk) => {
				this.processChunk(chunk);
			}
		});
	}

	process(text: string): void {
		this._lexer.process(text);
	}

	flush(): void {
		this._lexer.flush();
		// Also flush the default text processor if available
		if (this._defaultTextProcessor) {
			this._defaultTextProcessor.flush();
		}
	}

	private processChunk(chunk: any): void {
		// Proceed through the states in the expected order.
		// NOTE: This does not currently handle unexpected or out-of-order tags.
		switch (this._state) {
			case 'pending_replaceString_open': {
				if (chunk.type === 'text') {
					this.onPlainText(chunk.text);
				} else if (chunk.type === 'tag' && chunk.kind === 'open' && chunk.name === 'replaceString') {
					this._state = 'pending_old_open';
				}
				break;
			}
			case 'pending_old_open': {
				if (chunk.type === 'tag' && chunk.kind === 'open' && chunk.name === 'old') {
					this._state = 'pending_old_close';
				}
				break;
			}
			case 'pending_old_close': {
				if (chunk.type === 'text') {
					this.onOldText(chunk.text);
				} else if (chunk.type === 'tag' && chunk.kind === 'close' && chunk.name === 'old') {
					this.onOldClose();
					this._state = 'pending_new_open';
				}
				break;
			}
			case 'pending_new_open': {
				if (chunk.type === 'tag' && chunk.kind === 'open' && chunk.name === 'new') {
					this._state = 'pending_new_close';
				}
				break;
			}
			case 'pending_new_close': {
				if (chunk.type === 'text') {
					this.onNewText(chunk.text);
				} else if (chunk.type === 'tag' && chunk.kind === 'close' && chunk.name === 'new') {
					this._state = 'pending_replaceString_close';
				}
				break;
			}
			case 'pending_replaceString_close': {
				if (chunk.type === 'tag' && chunk.kind === 'close' && chunk.name === 'replaceString') {
					this._state = 'pending_replaceString_open';
				}
				break;
			}
		}
	}

	private onPlainText(text: string) {
		// Outside of a replaceString tag, delegate to the default text processor if available
		if (this._defaultTextProcessor) {
			this._defaultTextProcessor.process(text);
		} else {
			// Fallback to treating it as markdown
			this._response.markdown(text);
		}
	}

	private onOldText(text: string) {
		// Accumulate the old text in the buffer.
		this._oldTextBuffer += text;
	}

	private onOldClose() {
		// Find the text to replace in the document.
		// TODO: Should this error if there are multiple matches?
		const startPos = this._document.getText().indexOf(this._oldTextBuffer);
		if (startPos === -1) {
			throw new Error(`Could not replace text, old text not found: ${this._oldTextBuffer}.`);
		}

		// Create a text edit to delete the old text.
		const startPosition = this._document.positionAt(startPos);
		const endPosition = this._document.positionAt(startPos + this._oldTextBuffer.length);
		const range = new vscode.Range(startPosition, endPosition);
		const textEdit = vscode.TextEdit.delete(range);

		// Send the text edit to the response stream.
		this._response.textEdit(this._document.uri, textEdit);

		// Update the insert position to the end of the deleted text.
		this._insertPosition = startPosition;

		// Reset the old text buffer.
		this._oldTextBuffer = '';
	}

	private onNewText(text: string) {
		if (!this._insertPosition) {
			throw new Error('Encountered a <new> tag without an insert position');
		}

		// Create a text edit to insert the new text at the current insert position.
		const textEdit = vscode.TextEdit.insert(this._insertPosition, text);

		// Send the text edit to the response stream.
		this._response.textEdit(this._document.uri, textEdit);

		// Move the insert position to the end of the inserted text.
		const lines = text.split(/\r?\n/);
		const lineDelta = lines.length - 1;
		const characterDelta = lines.at(-1)!.length;
		this._insertPosition = this._insertPosition.translate(lineDelta, characterDelta);
	}
}
