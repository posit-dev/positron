/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import express from 'express';
import path = require('path');
import fs = require('fs');

import { Disposable, Uri } from 'vscode';
import { PromiseHandles } from './util';
import { isAddressInfo } from './positronProxy';

/**
 * HtmlProxyServer class.
 *
 * HtmlProxyServer wraps an Express server that serves static HTML content. All
 * the content is served by the same server, but each piece of content is served
 * from a unique path.
 */
export class HtmlProxyServer implements Disposable {
	private readonly _app = express();
	private readonly _server;

	private readonly _paths = new Map<string, string>();
	private readonly _ready: PromiseHandles<void> = new PromiseHandles();

	/**
	 * Construct a new HtmlProxyServer; creates the server and listens on a
	 * random port on localhost.
	 */
	constructor() {
		this._server = this._app.listen(0, 'localhost', () => {
			this._ready.resolve();
		});
	}

	/**
	 * Creates a unique URL that serves the content at the specified path.
	 *
	 * @param targetPath The path to the content to serve. May be specified as a
	 * file URI or a plain path, and may be a file or a directory. When a file
	 * is specified, the parent directory is served and the filename is appended
	 * to the URL.
	 * @returns A URL that serves the content at the specified path.
	 */
	public async createHtmlProxy(targetPath: string): Promise<string> {
		// Wait for the server to be ready.
		await this._ready.promise;

		// The targetPath may be specified as a file URI or a file path. If it's
		// a file URI, convert it to a file path first.
		try {
			const uri = Uri.parse(targetPath);
			if (uri.scheme === 'file') {
				targetPath = uri.fsPath;
			}
		} catch {
			// Ignore parse failures; expected when the target path is not a
			// URI.
		}

		// Ensure the target path exists.
		if (!fs.existsSync(targetPath)) {
			throw new Error(`Path does not exist: ${targetPath}`);
		}

		// Generate a random 8-character hex string to use as the path, and
		// ensure it's unique.
		let serverPath = '';
		do {
			serverPath = Math.random().toString(16).substring(2, 10);
		} while (this._paths.has(serverPath));

		// Is the target path a file, or a directory? If it's a file, we'll
		// serve the parent directory and then amend the filename to the URL.
		let filename = '';
		const isFile = fs.statSync(targetPath).isFile();
		if (isFile) {
			filename = path.basename(targetPath);
			targetPath = path.dirname(targetPath);
		}

		// Create a new path entry.
		this._app.use(`/${serverPath}`, express.static(targetPath));
		const address = this._server.address();
		if (!isAddressInfo(address)) {
			throw new Error(`Server address is not available; cannot serve ${targetPath}`);
		}
		return `http://${address.address}:${address.port}/${serverPath}/${filename}`;
	}

	dispose() {
		this._server.close();
	}
}
