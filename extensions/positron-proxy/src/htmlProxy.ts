/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import express from 'express';
import path = require('path');
import fs = require('fs');

import { Disposable, Uri } from 'vscode';
import { injectPreviewResources, PromiseHandles } from './util';
import { isAddressInfo, ProxyServerHtml } from './types';

/**
 * Watches the files a mount has served, and calls back when one changes.
 */
class MountWatch implements Disposable {
	private readonly _watchers = new Map<string, vscode.FileSystemWatcher>();
	private _timer: NodeJS.Timeout | undefined;

	constructor(private readonly _files: Set<string>, private readonly _onDidChange: () => void) {
		for (const file of _files) {
			this.add(file);
		}
	}

	/** Watches the directory that holds a served file. */
	add(file: string) {
		const dir = path.dirname(file);
		if (this._watchers.has(dir)) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(Uri.file(dir), '*'));
		const changed = (uri: Uri) => {
			if (this._files.has(uri.fsPath)) {
				clearTimeout(this._timer);
				this._timer = setTimeout(this._onDidChange, 300);
			}
		};
		watcher.onDidChange(changed);
		watcher.onDidCreate(changed);
		this._watchers.set(dir, watcher);
	}

	dispose() {
		clearTimeout(this._timer);
		this._watchers.forEach(watcher => watcher.dispose());
	}
}

/**
 * A directory the server serves, and the files it has served from it.
 */
interface Mount {
	readonly files: Set<string>;
	watch?: MountWatch;
}

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

	private readonly _mounts = new Map<string, Mount>();
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
	public async createHtmlProxy(
		targetPath: string,
		htmlConfig?: ProxyServerHtml
	): Promise<string> {
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
		} while (this._mounts.has(serverPath));

		// Is the target path a file, or a directory? If it's a file, we'll
		// serve the parent directory and then amend the filename to the URL.
		let filename = '';
		const isFile = fs.statSync(targetPath).isFile();
		if (isFile) {
			filename = path.basename(targetPath);
			targetPath = path.dirname(targetPath);
		}

		// Record the files served, so they can be watched for changes.
		const mount: Mount = { files: new Set() };
		this._mounts.set(serverPath, mount);
		const root = targetPath;
		this._app.use(`/${serverPath}`, async (req: any, _res: any, next: any) => {
			try {
				// Normalized as the watcher's URIs are, e.g. the drive letter's case.
				const file = Uri.file(path.join(root, decodeURIComponent(req.path))).fsPath;
				if (!path.relative(root, file).startsWith('..') && (await fs.promises.stat(file)).isFile()) {
					mount.files.add(file);
					mount.watch?.add(file);
				}
			} catch {
				// The file doesn't exist or the path is malformed; nothing to record.
			}
			next();
		});

		// Create a new path entry.
		if (vscode.env.uiKind !== vscode.UIKind.Web) {
			this._app.use(`/${serverPath}`, express.static(targetPath));
		} else {
			// If we're running in the web, we need to inject resources for the preview HTML.
			this._app.use(`/${serverPath}`, async (req: any, res: any, next: any) => {
				const filePath = path.join(targetPath, req.path);
				if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
					const fileExt = path.extname(filePath).toLowerCase();
					const isHtmlFile = ['.html', '.htm'].includes(fileExt);

					if (isHtmlFile) {
						// For HTML files, read as text and potentially inject resources
						let content = fs.readFileSync(filePath, 'utf8');
						if (htmlConfig) {
							content = injectPreviewResources(content, htmlConfig);
						}
						res.send(content);
					} else {
						// For non-HTML files, use sendFile with root option for security and proper Content-Type.
						// The root option prevents path traversal attacks by restricting file access to within
						// targetPath.
						res.sendFile(req.path, { root: targetPath });
					}
				} else {
					next();
				}
			});
		}
		const address = this._server.address();
		if (!isAddressInfo(address)) {
			throw new Error(`Server address is not available; cannot serve ${targetPath}`);
		}
		return `http://${address.address}:${address.port}/${serverPath}/${filename}`;
	}

	/**
	 * Watches the files served for the content at a URL.
	 *
	 * @param url The URL of the content, which may have been forwarded to
	 * another origin.
	 * @param onDidChange Called when a file the content loaded changes.
	 * @returns An ID for the watch, or undefined if the server doesn't serve
	 * the URL.
	 */
	watch(url: string, onDidChange: (id: string) => void): string | undefined {
		const id = Uri.parse(url).path.split('/').find(segment => this._mounts.has(segment));
		const mount = id && this._mounts.get(id);
		if (!mount) {
			return undefined;
		}
		mount.watch?.dispose();
		mount.watch = new MountWatch(mount.files, () => onDidChange(id));
		return id;
	}

	/**
	 * Stops watching the files served for content.
	 *
	 * @param id The ID returned by `watch`.
	 */
	unwatch(id: string) {
		const mount = this._mounts.get(id);
		mount?.watch?.dispose();
		if (mount) {
			mount.watch = undefined;
		}
	}

	dispose() {
		this._mounts.forEach(mount => mount.watch?.dispose());
		this._server.close();
	}
}
