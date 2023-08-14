/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
type ContentRewriter = (serverOrigin: string, url: string, contentType: string, responseBuffer: Buffer) => Promise<Buffer | string>;

/**
 * Custom custom type guard for AddressInfo.
 * @param _ The value.
 * @returns true if the value is aAddressInfo AddressInfo; otherwise, false.
 */
const isAddressInfo = (_: string | AddressInfo | null): _ is AddressInfo =>
	(_ as AddressInfo).address !== undefined &&
	(_ as AddressInfo).family !== undefined &&
	(_ as AddressInfo).port !== undefined;

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
	 * Gets a help proxy server
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startHelpProxyServer(targetOrigin: string): Promise<string> {
		return this.startProxyServer(targetOrigin, async (serverOrigin, url, contentType, responseBuffer) => {
			if (!contentType.includes('text/html')) {
				return responseBuffer;
			}

			// The script to inject.
			const script = `<script>
			(function() {
				var links = document.links;
				for (let i = 0; i < links.length; i++) {
					links[i].onclick = (e) => {
						e.preventDefault();
						window.parent.postMessage({
							command: "open-url",
							href: links[i].href
						}, "*");
					};
				}
			})();
			</script>`;

			const fullUrl = serverOrigin + url;
			let response = responseBuffer.toString('utf8');
			const div = `<div style="color: red;">Inserted by Positron help proxy for URL ${fullUrl}</div>`;
			response = response.replace('<body>', `<body>${div}`);
			response = response.replace('</body>', `${div}${script}</body>`);

			return response;
		});
	}

	//#endregion Public Methods

	//#region Private Methods

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
					onProxyReq: (proxyReq, req, res, options) => {
						console.log(`Proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}`);
					},
					onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
						// Get the URL and the content type. For HTTP
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
