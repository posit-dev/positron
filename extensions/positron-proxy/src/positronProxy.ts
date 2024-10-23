/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import express from 'express';
import { AddressInfo, Server } from 'net';
import { log, ProxyServerStyles } from './extension';
// eslint-disable-next-line no-duplicate-imports
import { Disposable, ExtensionContext } from 'vscode';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { HtmlProxyServer } from './htmlProxy';
import { htmlContentRewriter, removeTrailingSlash, rewriteUrlsWithProxyPath } from './util';

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
 * PendingProxyServer type.
 */
type PendingProxyServer = {
	externalUri: vscode.Uri;
	proxyPath: string;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

/**
 * MaybeAddressInfo type.
 */
type MaybeAddressInfo = AddressInfo | string | null | undefined;

/**
 * Custom type guard for AddressInfo.
 * @param addressInfo The value to type guard.
 * @returns true if the value is an AddressInfo; otherwise, false.
 */
export const isAddressInfo = (
	addressInfo: MaybeAddressInfo
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
			log.error(`Failed to load the resources/scripts_help.html file: ${JSON.stringify(error)}`);
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
		log.debug(`Starting a help proxy server for target: ${targetOrigin}...`);

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
				response = rewriteUrlsWithProxyPath(response, proxyPath);

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
		log.debug(`Stopping proxy server for target: ${targetOrigin}...`);

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
		log.debug(`Starting an HTML proxy server for target: ${targetPath}...`);

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
		log.debug(`Starting an HTTP proxy server for target: ${targetOrigin}...`);
		// Start the proxy server.
		return this.startProxyServer(targetOrigin, htmlContentRewriter);
	}

	/**
	 * Starts an HTTP proxy server that is pending middleware setup.
	 * Use this instead of startHttpProxyServer if you need to set up a proxy in steps instead of
	 * all at once. For example, you may want to start the proxy server and pass the proxy path to
	 * an application framework, start the app and get the targetOrigin, and then add the middleware
	 * to the proxy server.
	 * @returns The pending proxy server info.
	 */
	startPendingHttpProxyServer(): Promise<PendingProxyServer> {
		log.debug('Starting a pending HTTP proxy server...');
		// Start the proxy server and return the pending proxy server info. The caller will need to
		// call finishProxySetup to complete the proxy setup.
		return this.startNewProxyServer(htmlContentRewriter);
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Starts a proxy server.
	 * @param targetOrigin The target origin.
	 * @param contentRewriter The content rewriter.
	 * @returns The server origin, resolved to an external uri if applicable.
	 */
	private async startProxyServer(targetOrigin: string, contentRewriter: ContentRewriter): Promise<string> {
		// Remove the trailing slash from the target origin if it exists.
		const target = removeTrailingSlash(targetOrigin);

		// See if we have an existing proxy server for target origin. If there is, return the
		// server origin.
		const proxyServer = this._proxyServers.get(target);
		if (proxyServer) {
			log.debug(`Existing proxy server ${proxyServer.serverOrigin} found for target: ${target}.`);
			return proxyServer.serverOrigin;
		}

		let pendingProxy: PendingProxyServer;
		try {
			// We don't have an existing proxy server for the target origin, so start a new one.
			pendingProxy = await this.startNewProxyServer(contentRewriter);
		} catch (error) {
			log.error(`Failed to start a proxy server for ${target}: ${JSON.stringify(error)}`);
			throw error;
		}

		const externalUri = pendingProxy.externalUri.toString(true);
		try {
			// Finish setting up the proxy server.
			await pendingProxy.finishProxySetup(target);
		} catch (error) {
			log.error(`Failed to finish setting up the proxy server at ${externalUri} for target ${target}: ${JSON.stringify(error)}`);
			throw error;
		}

		// Return the external URI.
		return externalUri;
	}

	/**
	 * Starts a proxy server that is pending middleware setup.
	 * This is used to create a server and app that will be used to add middleware later.
	 * @returns The server origin and the proxy path.
	 */
	private async startNewProxyServer(contentRewriter: ContentRewriter): Promise<PendingProxyServer> {
		// Create the app and start listening on a random port.
		const app = express();
		let address: MaybeAddressInfo;
		const server = await new Promise<Server>((resolve, reject) => {
			const srv = app.listen(0, HOST, () => {
				// Get the server address.
				address = srv.address();
				resolve(srv);
			});
			srv.on('error', reject);
		});

		// Ensure the address is an AddressInfo.
		if (!isAddressInfo(address)) {
			const error = `Failed to get the address info ${JSON.stringify(address)} for the server.`;
			log.error(error);
			server.close();
			throw new Error(error);
		}

		// Create the server origin.
		const serverOrigin = `http://${address.address}:${address.port}`;

		// Convert the server origin to an external URI.
		const originUri = vscode.Uri.parse(serverOrigin);
		let externalUri = await vscode.env.asExternalUri(originUri);

		// Remove the trailing slash from the external URI path if it exists.
		externalUri = externalUri.with({
			path: removeTrailingSlash(externalUri.path)
		});

		log.debug(`Started proxy server at ${serverOrigin} for external URI ${externalUri.toString(true)}.`);

		// Return the pending proxy info.
		return {
			externalUri: externalUri,
			proxyPath: externalUri.path,
			finishProxySetup: (targetOrigin: string) => {
				return this.finishProxySetup(
					targetOrigin,
					serverOrigin,
					externalUri,
					server,
					app,
					contentRewriter
				);
			}
		} satisfies PendingProxyServer;
	}

	/**
	 * Finishes setting up the proxy server by adding the proxy middleware.
	 * @param targetOrigin The target origin.
	 * @param serverOrigin The server origin.
	 * @param externalUri The external URI.
	 * @param server The server.
	 * @param app The express app.
	 * @param contentRewriter The content rewriter.
	 * @returns A promise that resolves when the proxy setup is complete.
	 */
	private async finishProxySetup(
		targetOrigin: string,
		serverOrigin: string,
		externalUri: vscode.Uri,
		server: Server,
		app: express.Express,
		contentRewriter: ContentRewriter
	) {
		// Remove the trailing slash from the target origin if it exists.
		const target = removeTrailingSlash(targetOrigin);

		log.debug(`Finishing proxy server setup for target ${target}\n` +
			`\tserverOrigin: ${serverOrigin}\n` +
			`\texternalUri: ${externalUri.toString(true)}`
		);

		// Add the proxy server.
		this._proxyServers.set(target, new ProxyServer(
			serverOrigin,
			target,
			server
		));

		// Add the proxy middleware.
		app.use('*', createProxyMiddleware({
			target: target,
			changeOrigin: true,
			selfHandleResponse: true,
			ws: true,
			onProxyReq: (proxyReq, req, _res, _options) => {
				log.trace(`onProxyReq - proxy request ${serverOrigin}${req.url} -> ${target}${req.url}` +
					`\n\tmethod: ${proxyReq.method}` +
					`\n\tprotocol: ${proxyReq.protocol}` +
					`\n\thost: ${proxyReq.host}` +
					`\n\turl: ${proxyReq.path}` +
					`\n\theaders: ${JSON.stringify(proxyReq.getHeaders())}` +
					`\n\texternal uri: ${externalUri.toString(true)}`
				);
			},
			onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, _res) => {
				log.trace(`onProxyRes - proxy response ${target}${req.url} -> ${serverOrigin}${req.url}` +
					`\n\tstatus: ${proxyRes.statusCode}` +
					`\n\tstatusMessage: ${proxyRes.statusMessage}` +
					`\n\theaders: ${JSON.stringify(proxyRes.headers)}` +
					`\n\texternal uri: ${externalUri.toString(true)}`
				);

				// Get the URL and the content type. These must be present to call the
				// content rewriter. Also, the scripts must be loaded.
				const url = req.url;
				const contentType = proxyRes.headers['content-type'];
				if (!url || !contentType || !this._scriptsFileLoaded) {
					log.trace(`onProxyRes - skipping response processing for ${serverOrigin}${url}`);
					// Don't process the response.
					return responseBuffer;
				}

				// Rewrite the content.
				return contentRewriter(serverOrigin, externalUri.path, url, contentType, responseBuffer);
			})
		}));
	}

	//#endregion Private Methods
}
