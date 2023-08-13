/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// import * as positron from 'positron';

import { AddressInfo, Server } from 'net';
import { Disposable, ExtensionContext } from 'vscode';
import express, { Application, Express, Request, Response } from 'express';
import { createProxyMiddleware, Filter, Options, RequestHandler, responseInterceptor } from 'http-proxy-middleware';
import { JSDOM } from 'jsdom';

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
 * The Jupyter Adapter API as exposed by the Jupyter Adapter extension.
 */
export interface PositronProxy extends Disposable { }

// Configuration
const PORT = 6464;
const HOST = 'localhost';

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
		// // The /start-proxy route.
		// this.app.post('/start-proxy/:proxyPort', async (req, res) => {
		// 	// Get the proxy port.
		// 	const proxyPort = Number(req.params.proxyPort);
		// 	if (isNaN(proxyPort) || !Number.isInteger(proxyPort)) {
		// 		res.sendStatus(500);
		// 		return;
		// 	}

		// 	const app = express();

		// 	this.app.get('*', (req, res, next) => {
		// 		res.send('PROXY SERVER IS LISTENING');
		// 		res.send('/info response here!!!');
		// 	});

		// 	const server = app.listen(0, HOST, () => {
		// 		const address = server.address();
		// 		if (!isAddressInfo(address)) {
		// 			server.close();
		// 		} else {
		// 			this.proxyServers.push(app);
		// 			console.log(`New server started on port ${address.port}`);
		// 		}
		// 	});

		// 	// // Start the Proxy
		// 	// const tt = this.app.listen(0, HOST, () => {
		// 	// 	console.log(`It's ${tt.address()}`);
		// 	// 	console.log(`++++++++++++++++++++++++++++++ PositronProxy listening at ${HOST}:${PORT}`);
		// 	// });
		// 	// const appyo = express();

		// 	// const server = appyo.listen(0, () => {

		// 	// 	const foo = server.address();

		// 	// 	console.log('Listening on port:', server.address().port);
		// 	// });

		// 	res.send(`/startProxy on port ${req.params.proxyPort}`);
		// });

		// this.app.get('/info', (req, res, next) => {
		// 	res.send('/info response here!!!');
		// });

		// this.app.get('*', (req, res, next) => {
		// 	res.send('/* response');
		// });

		// // Start the Proxy
		// this.app.listen(PORT, HOST, () => {
		// 	console.log(`++++++++++++++++++++++++++++++ PositronProxy listening at ${HOST}:${PORT}`);
		// });
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

	//getProxy(port: number): P

	/**
	 * Gets a proxy server
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startProxyServer(targetOrigin: string): Promise<string> {
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
					server
				));

				console.log(`PositronProxy creating proxy server for ${targetOrigin}`);

				// Add the proxy midleware.
				app.use('*', createProxyMiddleware({
					target: targetOrigin,
					changeOrigin: true,
					selfHandleResponse: true,
					onProxyReq: (proxyReq, req, res, options) => {
						console.log(`Proxying ${serverOrigin} to ${targetOrigin} for ${req.url}`);
					},
					onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {

						if (proxyRes.headers['content-type']?.includes('text/html')) {
							console.log(`PositronProxy is adulterating HTML for ${req.url}`);

							const response = responseBuffer.toString('utf8');

							const jsdom = new JSDOM(response);

							const bodyElements = jsdom.window.document.getElementsByTagName('body');
							bodyElements[0].insertAdjacentHTML('afterbegin', '<div style="color: red; font-size: 20px;">This div was inserted by the PositronProxy using JSDOM!</div>');
							const dfd = `<script>
console.log("This output comes from a script tag that was inserted by the PositronProxy using JSDOM!");
</script>`;
							bodyElements[0].insertAdjacentHTML('beforeend', dfd);


							const yaya = jsdom.serialize().replace('Microsoft', 'W3Schools');

							// console.log(yaya);

							return yaya;


							// const response = responseBuffer.toString('utf8');
							// return response;


						} else {
							return responseBuffer;
						}

					})
				}));

				// Return the server origin.
				resolve(serverOrigin);
			});
		});
	}

	//#endregion Public Methods
}
