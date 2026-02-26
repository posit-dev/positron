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
			case 'pending_replaceString_open': {
				if (chunk.type === 'text') {
					await this.onPlainText(chunk.text);
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

	private async onPlainText(text: string): Promise<void> {
		// Outside of a replaceString tag, delegate to the default text processor if available
		if (this._defaultTextProcessor) {
			await this._defaultTextProcessor.process(text);
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
		const documentText = this._document.getText();

		// If we have a previous insert position, search from that position onwards
		// to handle sequential edits correctly.
		const searchStartOffset = this._insertPosition
			? this._document.offsetAt(this._insertPosition)
			: 0;

		// Find the first occurrence of the text to replace
		const startPos = documentText.indexOf(this._oldTextBuffer, searchStartOffset);
		if (startPos === -1) {
			throw new Error(`Could not replace text, old text not found: ${this._oldTextBuffer}.`);
		}

		// Check if there are multiple occurrences after the search start position
		const nextOccurrence = documentText.indexOf(this._oldTextBuffer, startPos + 1);
		if (nextOccurrence !== -1) {
			// Multiple matches found - this is ambiguous
			const startLine = this._document.positionAt(startPos).line + 1;
			const nextLine = this._document.positionAt(nextOccurrence).line + 1;
			const preview = this._oldTextBuffer.length > 50
				? this._oldTextBuffer.substring(0, 50) + '...'
				: this._oldTextBuffer;

			throw new Error(
				`Cannot replace text: found multiple occurrences of the text to replace.\n` +
				`First match at line ${startLine}, another at line ${nextLine}.\n` +
				`Text: "${preview}"\n` +
				`Please provide more unique context that appears only once in the document.`
			);
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
