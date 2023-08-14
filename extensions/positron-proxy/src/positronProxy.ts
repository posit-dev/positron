/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import fs = require('fs');
import path = require('path');
import { JSDOM } from 'jsdom';
import express from 'express';
import { AddressInfo, Server } from 'net';
import { Disposable, ExtensionContext } from 'vscode';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

/**
 * Constants.
 */
const HOST = 'localhost';

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
 * @param addressInfo The value.
 * @returns true if the value is aAddressInfo AddressInfo; otherwise, false.
 */
const isAddressInfo = (addressInfo: string | AddressInfo | null): addressInfo is AddressInfo =>
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
	 * @param type The type. (Right now, only help is supported.)
	 * @param server The server.
	 */
	constructor(
		readonly serverOrigin: string,
		readonly targetOrigin: string,
		private readonly type: 'help',
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
	 * A value which indicates whether scripts have been loaded from resources/scripts.html.
	 */
	private scriptsLoaded = false;

	/**
	 * The help header script.
	 */
	private helpHeaderScript?: string;

	/**
	 * The proxy servers, keyed by target origin.
	 */
	private proxyServers = new Map<string, ProxyServer>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param context The extension context.
	 */
	constructor(private readonly context: ExtensionContext) {
	}

	/**
	 * Disposes of the PositronProxy.
	 */
	dispose(): void {
		this.proxyServers.forEach(proxyServer => {
			proxyServer.dispose();
		});
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Starts a help proxy server
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startHelpProxyServer(targetOrigin: string): Promise<string> {
		// Start the proxy server.
		return this.startProxyServer(targetOrigin, async (serverOrigin, url, contentType, responseBuffer) => {
			// Only HTML content is processed below.
			if (!contentType.includes('text/html')) {
				return responseBuffer;
			}

			// Inject the help header script.
			let response = responseBuffer.toString('utf8');
			response = response.replace('</head>', `${this.helpHeaderScript}</head>`);

			// Return the response.
			return response;
		});
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Loads scripts from the resources/scripts.html file.
	 */
	private loadScripts() {
		// If scripts have been loaded, return.
		if (this.scriptsLoaded) {
			return;
		}

		// Try to load the resources/scripts.html file and the scripts within it.
		try {
			// Load the resources/scripts.html file.
			const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts.html');
			const jsdom = new JSDOM(fs.readFileSync(scriptsPath));
			const document = jsdom.window.document;

			// Load the scripts from within the file.
			this.helpHeaderScript = document.querySelector('#help-header-script')?.outerHTML;

			// Set the scripts loaded flag.
			this.scriptsLoaded = true;
		} catch (error) {
			console.log(`Failed to load the resources/scripts.html file`);
		}
	}

	/**
	 * Starts a proxy server.
	 * @param targetOrigin The target origin.
	 * @param contentRewriter The content rewriter/
	 * @returns The server origin.
	 */
	startProxyServer(targetOrigin: string, contentRewriter: ContentRewriter): Promise<string> {
		this.loadScripts();

		// Return a promise.
		return new Promise((resolve, reject) => {
			// See if we have an existing proxy server for target origin. If there is, return the
			// server origin.
			const proxyServer = this.proxyServers.get(targetOrigin);
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
				this.proxyServers.set(targetOrigin, new ProxyServer(
					serverOrigin,
					targetOrigin,
					'help',
					server
				));

				// Add the proxy midleware.
				app.use('*', createProxyMiddleware({
					target: targetOrigin,
					changeOrigin: true,
					selfHandleResponse: true,
					onProxyReq: (proxyReq, req, res, options) => {
						console.log(`Proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}`);
					},
					onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
						// Get the URL and the content type. These must be present to call the
						// content rewriter.
						const url = req.url;
						const contentType = proxyRes.headers['content-type'];
						if (!url || !contentType) {
							// Don't process the response.
							return responseBuffer;
						}

						// Rewrite the content.
						return contentRewriter(serverOrigin, url, contentType, responseBuffer);
					})
				}));

				// Return the server origin.
				resolve(serverOrigin);
			});
		});
	}

	//#endregion Private Methods
}
