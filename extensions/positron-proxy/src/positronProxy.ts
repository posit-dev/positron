/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import express from 'express';
import { AddressInfo, Server } from 'net';
import { ProxyServerStyles } from './extension';
import { Disposable, ExtensionContext } from 'vscode';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { HtmlProxyServer } from './htmlProxy';

/**
 * Constants.
 */
const HOST = 'localhost';

/**
 * Gets a style element out of the scripts file. Style elements must be in the form:
 * <style id="identifier">
 * ....
 * </style>
 * @param script The script.
 * @param id The element id.
 * @returns The element, if found; otherwise, undefined.
 */
const getStyleElement = (script: string, id: string) =>
	script.match(new RegExp(`<style id="${id}">.*?<\/style>`, 'gs'))?.[0];

/**
 * Gets a script element out of the scripts file. Script tags must be in the form:
 * <script id="identifier" type="module">
 * ...
 * </script>
 * @param script The script.
 * @param id The element id.
 * @returns The element, if found; otherwise, undefined.
 */
const getScriptElement = (script: string, id: string) =>
	script.match(new RegExp(`<script id="${id}" type="module">.*?<\/script>`, 'gs'))?.[0];

/**
 * ContentRewriter type.
 */
type ContentRewriter = (
	serverOrigin: string,
	url: string,
	contentType: string,
	responseBuffer: Buffer
) => Promise<Buffer | string>;

/**
 * Custom type guard for AddressInfo.
 * @param addressInfo The value to type guard.
 * @returns true if the value is an AddressInfo; otherwise, false.
 */
export const isAddressInfo = (
	addressInfo: string | AddressInfo | null
): addressInfo is AddressInfo =>
	(addressInfo as AddressInfo).address !== undefined &&
	(addressInfo as AddressInfo).family !== undefined &&
	(addressInfo as AddressInfo).port !== undefined;

/**
 * ProxyServer class.
 */
export class ProxyServer implements Disposable {
	/**
	 * Constructor.
	 * @param serverOrigin The server origin.
	 * @param targetOrigin The target origin.
	 * @param server The server.
	 */
	constructor(
		readonly serverOrigin: string,
		readonly targetOrigin: string,
		private readonly server: Server,
	) {
	}

	/**
	 * Disposes of the ProxyServer.
	 */
	dispose(): void {
		this.server.close();
	}
}

/**
* PositronProxy class.
*/
export class PositronProxy implements Disposable {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the resources/scripts.html file has been loaded.
	 */
	private _scriptsFileLoaded = false;

	/**
	 * Gets or sets the help styles.
	 */
	private _helpStyles?: ProxyServerStyles;

	/**
	 * Gets or sets the help style defaults.
	 */
	private _helpStyleDefaults?: string;

	/**
	 * Gets or sets the help style overrides.
	 */
	private _helpStyleOverrides?: string;

	/**
	 * Gets or sets the help script.
	 */
	private _helpScript?: string;

	/**
	 * Gets or sets the proxy servers, keyed by target origin.
	 */
	private _proxyServers = new Map<string, ProxyServer>();

	/**
	 * The HTML proxy server. There's only ever one of these; it serves all raw
	 * HTML content.
	 */
	private _htmlProxyServer?: HtmlProxyServer;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param context The extension context.
	 */
	constructor(private readonly context: ExtensionContext) {
		// Try to load the resources/scripts.html file and the elements within it. This will either
		// work or it will not work, but there's not sense in trying it again, if it doesn't.
		try {
			// Load the resources/scripts.html scripts file.
			const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts.html');
			const scripts = fs.readFileSync(scriptsPath).toString('utf8');

			// Get the elements from the scripts file.
			this._helpStyleDefaults = getStyleElement(scripts, 'help-style-defaults');
			this._helpStyleOverrides = getStyleElement(scripts, 'help-style-overrides');
			this._helpScript = getScriptElement(scripts, 'help-script');

			// Set the scripts file loaded flag if everything appears to have worked.
			this._scriptsFileLoaded =
				this._helpStyleDefaults !== undefined &&
				this._helpStyleOverrides !== undefined &&
				this._helpScript !== undefined;
		} catch (error) {
			console.log(`Failed to load the resources/scripts.html file.`);
		}
	}

	/**
	 * Disposes of the PositronProxy.
	 */
	dispose(): void {
		this._proxyServers.forEach(proxyServer => {
			proxyServer.dispose();
		});
		if (this._htmlProxyServer) {
			this._htmlProxyServer.dispose();
		}
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Starts a help proxy server.
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startHelpProxyServer(targetOrigin: string): Promise<string> {
		// Start the proxy server.
		return this.startProxyServer(
			targetOrigin,
			async (serverOrigin, url, contentType, responseBuffer) => {
				// If this isn't 'text/html' content, just return the response buffer.
				if (!contentType.includes('text/html')) {
					return responseBuffer;
				}

				// Build the help vars.
				let helpVars = '';
				if (this._helpStyles) {
					helpVars += '<style id="help-vars">\n';
					helpVars += '    body {\n';
					for (const style in this._helpStyles) {
						helpVars += `        --${style}: ${this._helpStyles[style]};\n`;
					}
					helpVars += '    }\n';
					helpVars += '</style>\n';
				}

				// Get the response.
				let response = responseBuffer.toString('utf8');

				// Inject the help style defaults for unstyled help documents and the help vars.
				response = response.replace(
					'<head>',
					`<head>\n
					${helpVars}\n
					${this._helpStyleDefaults}`
				);

				// Inject the help style overrides and the help script.
				response = response.replace(
					'</head>',
					`${this._helpStyleOverrides}\n
					${this._helpScript}\n
					</head>`
				);

				// Prepend root-relative URLs with the proxy path.
				const serverOriginUrl = new URL(serverOrigin);
				const proxyPath = `/proxy/${serverOriginUrl.port}`;
				response = response.replace(
					// Look for src="/ or href="/
					/(src|href)="\/([^"]+)"/g,
					`$1="${proxyPath}/$2"`
				);

				// Return the response.
				return response;
			});
	}

	/**
	 * Stops a help proxy server.
	 * @param targetOrigin The target origin.
	 * @returns A value which indicates whether the proxy server for the target origin was found and
	 * stopped.
	 */
	stopHelpProxyServer(targetOrigin: string): boolean {
		// See if we have a proxy server for the target origin. If we do, stop it.
		const proxyServer = this._proxyServers.get(targetOrigin);
		if (proxyServer) {
			// Remove and stop the proxy server.
			this._proxyServers.delete(targetOrigin);
			proxyServer.dispose();

			// A proxy server for the target origin was found and stopped.
			return true;
		}

		// A proxy server for the target origin was not found.
		return false;
	}

	/**
	 * Starts a proxy server to server local HTML content.
	 * @param targetPath The target path
	 * @returns The server URL.
	 */
	async startHtmlProxyServer(targetPath: string) {
		if (!this._htmlProxyServer) {
			this._htmlProxyServer = new HtmlProxyServer();
		}
		return this._htmlProxyServer.createHtmlProxy(targetPath);
	}

	/**
	 * Sets the help proxy server styles.
	 * @param styles The help proxy server styles.
	 */
	setHelpProxyServerStyles(styles: ProxyServerStyles) {
		// Set the help styles.
		this._helpStyles = styles;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Starts a proxy server.
	 * @param targetOrigin The target origin.
	 * @param contentRewriter The content rewriter/
	 * @returns The server origin.
	 */
	startProxyServer(targetOrigin: string, contentRewriter: ContentRewriter): Promise<string> {
		// Return a promise.
		return new Promise((resolve, reject) => {
			// See if we have an existing proxy server for target origin. If there is, return the
			// server origin.
			const proxyServer = this._proxyServers.get(targetOrigin);
			if (proxyServer) {
				resolve(proxyServer.serverOrigin);
				return;
			}

			// Create the app and start listening on a random port.
			const app = express();
			const server = app.listen(0, HOST, () => {
				// Get the server address.
				const address = server.address();

				// Ensure that we have the address info of the server.
				if (!isAddressInfo(address)) {
					server.close();
					reject();
					return;
				}

				// Create the server origin.
				const serverOrigin = `http://${address.address}:${address.port}`;

				// Add the proxy server.
				this._proxyServers.set(targetOrigin, new ProxyServer(
					serverOrigin,
					targetOrigin,
					server
				));

				// Add the proxy midleware.
				app.use('*', createProxyMiddleware({
					target: targetOrigin,
					changeOrigin: true,
					selfHandleResponse: true,
					// Logging for development work.
					// onProxyReq: (proxyReq, req, res, options) => {
					// 	console.log(`Proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}`);
					// },
					onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
						// Get the URL and the content type. These must be present to call the
						// content rewriter. Also, the scripts must be loaded.
						const url = req.url;
						const contentType = proxyRes.headers['content-type'];
						if (!url || !contentType || !this._scriptsFileLoaded) {
							// Don't process the response.
							return responseBuffer;
						}

						// Rewrite the content.
						return contentRewriter(serverOrigin, url, contentType, responseBuffer);
					})
				}));

				// Resolve the server origin as an external URI.
				const originUri = vscode.Uri.parse(serverOrigin);
				vscode.env.asExternalUri(originUri).then((externalUri) => {
					resolve(externalUri.toString());
				});
			});
		});
	}

	//#endregion Private Methods
}
