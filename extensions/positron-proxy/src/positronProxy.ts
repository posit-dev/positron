/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import fs = require('fs');
import path = require('path');
import express from 'express';
import { AddressInfo, Server } from 'net';
import { Disposable, ExtensionContext } from 'vscode';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

/**
 * Constants.
 */
const HOST = 'localhost';

/**
 * Gets an element out of a script.
 * @param script The script.
 * @param tag The element tag.
 * @param id The element id.
 * @returns The element, if found; otherwise, undefined.
 */
const getElement = (script: string, tag: string, id: string) =>
	script.match(new RegExp(`<${tag}\\s+id\\s*=\\s*("${id}"|'${id}')\\s*.*>.*<\/${tag}\\s*>`, 'gs'))?.[0];

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
	 * A value which indicates whether the resources/scripts.html file has been loaded.
	 */
	private scriptsFileLoaded = false;

	/**
	 * The help header style.
	 */
	private helpHeaderStyle?: string;

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
		// Try to load the resources/scripts.html file and the elements within it. This will either
		// work or it will not work, but there's not sense in trying it again, if it doesn't.
		try {
			// Load the resources/scripts.html file.
			const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts.html');
			const scripts = fs.readFileSync(scriptsPath).toString('utf8');

			// Get the elements from the file.
			this.helpHeaderStyle = getElement(scripts, 'style', 'help-header-style');
			this.helpHeaderScript = getElement(scripts, 'script', 'help-header-script');

			// Set the scripts file loaded flag if everything appears to have worked.
			this.scriptsFileLoaded =
				this.helpHeaderStyle !== undefined &&
				this.helpHeaderScript !== undefined;
		} catch (error) {
			console.log(`Failed to load the resources/scripts.html file.`);
		}
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
		return this.startProxyServer(
			targetOrigin,
			async (serverOrigin, url, contentType, responseBuffer) => {
				// If this isn't 'text/html' content, just return the response buffer.
				if (!contentType.includes('text/html')) {
					return responseBuffer;
				}

				// Inject styles and scripts.
				let response = responseBuffer.toString('utf8');
				// response = response.replace(
				// 	'<body>',
				// 	`<body><div class="url-information">Help URL is: ${url}</div>`
				// );
				response = response.replace(
					'</head>',
					`${this.helpHeaderStyle}\n${this.helpHeaderScript}</head>`
				);

				// Return the response.
				return response;
			});
	}

	/**
	 * Stops a help proxy server
	 * @param targetOrigin The target origin.
	 * @returns A value which indicates whether the proxy server for the target origin was found and
	 * stopped.
	 */
	stopHelpProxyServer(targetOrigin: string): boolean {
		// See if we have a proxy server for the target origin. If we do, stop it.
		const proxyServer = this.proxyServers.get(targetOrigin);
		if (proxyServer) {
			// Remove and stop the proxy server.
			this.proxyServers.delete(targetOrigin);
			proxyServer.dispose();

			// A proxy server for the target origin was found and stopped.
			return true;
		}

		// A proxy server for the target origin was not found.
		return false;
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
					// Logging for development work.
					// onProxyReq: (proxyReq, req, res, options) => {
					// 	console.log(`Proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}`);
					// },
					onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
						// Get the URL and the content type. These must be present to call the
						// content rewriter. Also, the scripts must be loaded.
						const url = req.url;
						const contentType = proxyRes.headers['content-type'];
						if (!url || !contentType || !this.scriptsFileLoaded) {
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
