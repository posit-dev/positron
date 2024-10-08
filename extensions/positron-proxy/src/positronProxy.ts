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
	proxyPath: string,
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
		readonly server: Server,
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
	 * Gets or sets a value which indicates whether the resources/scripts_{TYPE}.html files have been loaded.
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
		// Try to load the resources/scripts_{TYPE}.html files and the elements within them. This will either
		// work or it will not work, but there's not sense in trying it again, if it doesn't.

		// Load the scripts_help.html file for the help proxy server.
		try {
			// Load the resources/scripts_help.html scripts file.
			const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts_help.html');
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
			console.log(`Failed to load the resources/scripts_help.html file.`);
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
			async (_serverOrigin, proxyPath, _url, contentType, responseBuffer) => {
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

				// Rewrite the URLs with the proxy path.
				response = this.rewriteUrlsWithProxyPath(response, proxyPath);

				// Return the response.
				return response;
			});
	}

	/**
	 * Stops a proxy server.
	 * @param targetOrigin The target origin.
	 * @returns A value which indicates whether the proxy server for the target origin was found and
	 * stopped.
	 */
	stopProxyServer(targetOrigin: string): boolean {
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

	/**
	 * Starts an HTTP proxy server.
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startHttpProxyServer(targetOrigin: string): Promise<string> {
		// Start the proxy server.
		return this.startProxyServer(
			targetOrigin,
			async (_serverOrigin, proxyPath, _url, contentType, responseBuffer) => {
				// If this isn't 'text/html' content, just return the response buffer.
				if (!contentType.includes('text/html')) {
					return responseBuffer;
				}

				// Get the response.
				let response = responseBuffer.toString('utf8');

				// Rewrite the URLs with the proxy path.
				response = this.rewriteUrlsWithProxyPath(response, proxyPath);

				// Return the response.
				return response;
			});
	}

	/**
	 * Starts a proxy server that is pending middleware setup.
	 * This is used to create a server and app that will be used to add middleware later.
	 * @returns The server origin and the proxy path.
	 */
	startPendingProxyServer() {
		return new Promise((resolve, reject) => {
			// Create the app and start listening on a random port.
			const app = express();
			const server = app.listen(0, HOST, async () => {
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

				// Convert the server origin to an external URI.
				const originUri = vscode.Uri.parse(serverOrigin);
				const externalUri = await vscode.env.asExternalUri(originUri);

				// Resolve the server origin URI.
				resolve({
					// The serverOrigin will be used to look up the proxy server later.
					serverOrigin: serverOrigin.toString(),
					proxyPath: externalUri.path,
					finishProxySetup: (targetOrigin: string) => {
						return this.finishProxySetup(
							targetOrigin,
							serverOrigin,
							server,
							app,
							async (_serverOrigin, proxyPath, _url, contentType, responseBuffer) => {
								// If this isn't 'text/html' content, just return the response buffer.
								if (!contentType.includes('text/html')) {
									return responseBuffer;
								}

								// Get the response.
								let response = responseBuffer.toString('utf8');

								// Rewrite the URLs with the proxy path.
								response = this.rewriteUrlsWithProxyPath(response, proxyPath);

								// Return the response.
								return response;
							});
					}
				});
			});
		});

	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Starts a proxy server.
	 * @param targetOrigin The target origin.
	 * @param contentRewriter The content rewriter.
	 * @returns The server origin.
	 */
	private startProxyServer(targetOrigin: string, contentRewriter: ContentRewriter): Promise<string> {
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
			const server = app.listen(0, HOST, async () => {
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

				// Finish the proxy setup to get the external URI.
				const externalUri = await this.finishProxySetup(targetOrigin, serverOrigin, server, app, contentRewriter);

				// Resolve the server origin external URI.
				resolve(externalUri.toString());
			});
		});
	}

	private async finishProxySetup(targetOrigin: string, serverOrigin: string, server: Server, app: express.Express, contentRewriter: ContentRewriter) {
		// Add the proxy server.
		this._proxyServers.set(targetOrigin, new ProxyServer(
			serverOrigin,
			targetOrigin,
			server
		));

		// Convert the server origin to an external URI.
		const originUri = vscode.Uri.parse(serverOrigin);
		const externalUri = await vscode.env.asExternalUri(originUri);

		// Add the proxy middleware.
		app.use('*', createProxyMiddleware({
			target: targetOrigin,
			changeOrigin: true,
			selfHandleResponse: true,
			ws: true,
			// Logging for development work.
			// onProxyReq: (proxyReq, req, res, options) => {
			// 	console.log(`Proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}`);
			// },
			onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, _res) => {
				// Get the URL and the content type. These must be present to call the
				// content rewriter. Also, the scripts must be loaded.
				const url = req.url;
				const contentType = proxyRes.headers['content-type'];
				if (!url || !contentType || !this._scriptsFileLoaded) {
					// Don't process the response.
					return responseBuffer;
				}

				// Rewrite the content.
				return contentRewriter(serverOrigin, externalUri.path, url, contentType, responseBuffer);
			})
		}));

		// Return the server origin external URI.
		return externalUri.toString();
	}

	/**
	 * Rewrites the URLs in the content.
	 * @param content The content.
	 * @param proxyPath The proxy path.
	 * @returns The content with the URLs rewritten.
	 */
	private rewriteUrlsWithProxyPath(content: string, proxyPath: string): string {
		// When running on Web, we need to prepend root-relative URLs with the proxy path,
		// because the help proxy server is running at a different origin than the target origin.
		// When running on Desktop, we don't need to do this, because the help proxy server is
		// running at the same origin as the target origin (localhost).
		if (vscode.env.uiKind === vscode.UIKind.Web) {
			// Prepend root-relative URLs with the proxy path. The proxy path may look like
			// /proxy/<PORT> or a different proxy path if an external uri is used.
			return content.replace(
				// This is icky and we should use a proper HTML parser, but it works for now.
				// Possible sources of error are: whitespace differences, single vs. double
				// quotes, etc., which are not covered in this regex.
				// Regex translation: look for src="/ or href="/ and replace it with
				// src="<PROXY_PATH> or href="<PROXY_PATH> respectively.
				/(src|href)="\/([^"]+)"/g,
				(match, p1, p2, _offset, _string, _groups) => {
					// Add a leading slash to the matched path which was removed by the regex.
					const matchedPath = '/' + p2;

					// If the URL already starts with the proxy path, don't rewrite it. Some app
					// frameworks may already have rewritten the URLs.
					// Example: match = src="/proxy/1234/path/to/resource"
					//             p2 = "proxy/1234/path/to/resource"
					if (matchedPath.startsWith(proxyPath)) {
						return match;
					}

					// Example: src="/path/to/resource" -> src="/proxy/1234/path/to/resource"
					return `${p1}="${proxyPath}/${p2}"`;
				}
			);
		}

		// Return the content as-is.
		return content;
	}

	//#endregion Private Methods
}
