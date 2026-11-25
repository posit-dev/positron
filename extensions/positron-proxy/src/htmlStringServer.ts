/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import express from 'express';
import { Disposable } from 'vscode';
import { PromiseHandles } from './util';
import { isAddressInfo } from './types';

/** How many HTML strings are served at once; each can be large. */
const MAX_HTML_STRINGS = 20;

/**
 * Serves HTML strings, such as Quarto output, as pages, so the Viewer's
 * integrated browser can show them. Only the most recent are kept.
 */
export class HtmlStringServer implements Disposable {
	private readonly _app = express();
	private readonly _server;
	private readonly _ready = new PromiseHandles<void>();

	/** The HTML strings being served, by ID, oldest first. */
	private readonly _strings = new Map<string, string>();

	constructor() {
		this._server = this._app.listen(0, 'localhost', () => this._ready.resolve());
		this._app.get('/:id', (req, res) => {
			const html = this._strings.get(req.params.id);
			if (html === undefined) {
				res.status(404).send('This content is no longer available.');
			} else {
				res.type('html').send(html);
			}
		});
	}

	/**
	 * Serves an HTML string.
	 *
	 * @returns The URL it's served at.
	 */
	async serve(html: string): Promise<string> {
		await this._ready.promise;
		let id = '';
		do {
			id = Math.random().toString(16).substring(2, 10);
		} while (this._strings.has(id));
		this._strings.set(id, html);
		while (this._strings.size > MAX_HTML_STRINGS) {
			this._strings.delete(this._strings.keys().next().value!);
		}
		const address = this._server.address();
		if (!isAddressInfo(address)) {
			throw new Error('The HTML string server has no address.');
		}
		return `http://${address.address}:${address.port}/${id}`;
	}

	dispose() {
		this._server.close();
	}
}
