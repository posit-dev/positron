/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { StreamingTagLexer } from './streamingTagLexer.js';

/**
 * A text processor that handles warning tags and passes all other text as markdown.
 * This is the default processor for chat contexts that don't require streaming edits.
 */
export class DefaultTextProcessor {
	private readonly _lexer: StreamingTagLexer<string>;
	private _insideWarning = false;
	private _warningBuffer = '';

	constructor(
		private readonly _response: vscode.ChatResponseStream,
	) {
		this._lexer = new StreamingTagLexer({
			tagNames: ['warning'],
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

		// If we have buffered warning content at the end, emit it
		if (this._warningBuffer.trim()) {
			this._response.warning(this._warningBuffer.trim());
			this._warningBuffer = '';
		}
	}

	private async processChunk(chunk: any): Promise<void> {
		if (chunk.type === 'tag' && chunk.name === 'warning') {
			if (chunk.kind === 'open') {
				this._insideWarning = true;
			} else if (chunk.kind === 'close') {
				if (this._warningBuffer.trim()) {
					this._response.warning(this._warningBuffer.trim());
					this._warningBuffer = '';
				}
				this._insideWarning = false;
			}
		} else if (chunk.type === 'text') {
			if (this._insideWarning) {
				// Buffer warning text until the closing tag
				this._warningBuffer += chunk.text;
			} else {
				// All non-warning text goes to markdown
				this._response.markdown(chunk.text);
			}
		}
	}
}
