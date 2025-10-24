/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fs = require('fs');
import path = require('path');
import express from 'express';
import { Server } from 'net';
import { log, ProxyServerStyles } from './extension';

import { Disposable, ExtensionContext } from 'vscode';
// TODO: switch to using createProxyMiddleware when new options format is fixed
import { legacyCreateProxyMiddleware as createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { HtmlProxyServer } from './htmlProxy';
import { helpContentRewriter, htmlContentRewriter } from './util';
import { ContentRewriter, isAddressInfo, MaybeAddressInfo, PendingProxyServer, ProxyServerHtml, ProxyServerHtmlConfig, ProxyServerType } from './types';

/**
 * Constants.
 */
const HOST = 'localhost';

/**
 * Gets a style element out of the scripts file. Style elements must be in the form:
 * <style id="identifier">
 * ....
 * </style>
 * Noted in the resources/scripts_{TYPE}.html files.
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
 * Noted in the resources/scripts_{TYPE}.html files.
 * @param script The script.
 * @param id The element id.
 * @returns The element, if found; otherwise, undefined.
 */
const getScriptElement = (script: string, id: string) =>
	script.match(new RegExp(`<script id="${id}" type="module">.*?<\/script>`, 'gs'))?.[0];

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
		readonly serverType: ProxyServerType,
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
	 * Stores the proxy server HTML configurations.
	 */
	private _proxyServerHtmlConfigs: ProxyServerHtmlConfig;

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
		this._proxyServerHtmlConfigs = {
			help: this.loadHelpResources(),
			preview: this.loadPreviewResources(),
		};
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
		return this.startProxyServer(targetOrigin, helpContentRewriter, ProxyServerType.Help);
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
	 * Starts a proxy server to serve local HTML content.
	 * @param targetPath The target path
	 * @returns The server URL.
	 */
	async startHtmlProxyServer(targetPath: string): Promise<string> {
		log.debug(`Starting an HTML proxy server for target: ${targetPath}...`);

		if (!this._htmlProxyServer) {
			this._htmlProxyServer = new HtmlProxyServer();
		}

		return this._htmlProxyServer.createHtmlProxy(
			targetPath,
			this._proxyServerHtmlConfigs.preview
		);
	}

	/**
	 * Sets the help proxy server styles.
	 * @param styles The help proxy server styles.
	 */
	setHelpProxyServerStyles(styles: ProxyServerStyles) {
		// Set the help styles.
		this._proxyServerHtmlConfigs.help.styles = styles;
	}

	/**
	 * Starts an HTTP proxy server.
	 * @param targetOrigin The target origin.
	 * @returns The server origin.
	 */
	startHttpProxyServer(targetOrigin: string): Promise<string> {
		log.debug(`Starting an HTTP proxy server for target: ${targetOrigin}...`);
		// Start the proxy server.
		return this.startProxyServer(targetOrigin, htmlContentRewriter, ProxyServerType.Preview);
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
		return this.startNewProxyServer(htmlContentRewriter, ProxyServerType.Preview);
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Loads the help HTML resources and constructs the help HTML config.
	 * @returns The help HTML config or an empty object if something went wrong while loading resources.
	 */
	private loadHelpResources(): ProxyServerHtml {
		try {
			// Load the resources/scripts_help.html scripts file.
			const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts_help.html');
			const scripts = fs.readFileSync(scriptsPath).toString('utf8');

			// Construct the help HTML config.
			const helpHtmlConfig = new ProxyServerHtml(
				getStyleElement(scripts, 'help-style-defaults'),
				getStyleElement(scripts, 'help-style-overrides'),
				getScriptElement(scripts, 'help-script')
			);

			// Return the help HTML config.
			return helpHtmlConfig;
		} catch (error) {
			log.error(`Failed to load the resources/scripts_help.html file: ${JSON.stringify(error)}`);
		}

		// Return an empty help HTML config.
		return new ProxyServerHtml();
	}

	/**
	 * Loads the preview HTML resources and constructs the preview HTML config when running in the Web.
	 * @returns The preview HTML config or an empty object if something went wrong while loading resources.
	 */
	private loadPreviewResources(): ProxyServerHtml {
		// Load the preview resources only when running in the Web.
		if (vscode.env.uiKind === vscode.UIKind.Web) {
			try {
				// Load the resources/scripts_preview.html scripts file.
				const scriptsPath = path.join(this.context.extensionPath, 'resources', 'scripts_preview.html');
				const scripts = fs.readFileSync(scriptsPath).toString('utf8');

				// Inject the webview events script.
				const scriptEl = getScriptElement(scripts, 'preview-script');
				let previewScript;
				if (scriptEl) {
					const webviewEventsScriptPath = path.join(this.context.extensionPath, 'resources', 'webview-events.js');
					const webviewEventsScript = fs.readFileSync(webviewEventsScriptPath).toString('utf8');
					previewScript = scriptEl.replace('// webviewEventsScript placeholder', webviewEventsScript);
				}

				// Construct the preview HTML config.
				const previewHtmlConfig = new ProxyServerHtml(
					getStyleElement(scripts, 'preview-style-defaults'),
					getStyleElement(scripts, 'preview-style-overrides'),
					previewScript,
				);

				// Return the preview HTML config.
				return previewHtmlConfig;
			} catch (error) {
				log.error(`Failed to load the resources/scripts_preview.html file: ${JSON.stringify(error)}`);
			}
		}

		// Return an empty preview HTML config.
		return new ProxyServerHtml();
	}

	/**
	 * Starts a proxy server.
	 * @param targetOrigin The target origin.
	 * @param contentRewriter The content rewriter.
	 * @returns The server origin, resolved to an external uri if applicable.
	 */
	private async startProxyServer(targetOrigin: string, contentRewriter: ContentRewriter, serverType: ProxyServerType): Promise<string> {
		// See if we have an existing proxy server for target origin. If there is, return the
		// server origin.
		const proxyServer = this._proxyServers.get(targetOrigin);
		if (proxyServer) {
			log.debug(`Existing proxy server ${proxyServer.serverOrigin} found for target: ${targetOrigin}.`);
			return proxyServer.serverOrigin;
		}

		let pendingProxy: PendingProxyServer;
		try {
			// We don't have an existing proxy server for the target origin, so start a new one.
			pendingProxy = await this.startNewProxyServer(contentRewriter, serverType);
		} catch (error) {
			log.error(`Failed to start a proxy server for ${targetOrigin}: ${JSON.stringify(error)}`);
			throw error;
		}

		const externalUri = pendingProxy.externalUri.toString(true);
		try {
			// Finish setting up the proxy server.
			await pendingProxy.finishProxySetup(targetOrigin);
		} catch (error) {
			log.error(`Failed to finish setting up the proxy server at ${externalUri} for target ${targetOrigin}: ${JSON.stringify(error)}`);
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
	private async startNewProxyServer(contentRewriter: ContentRewriter, serverType: ProxyServerType): Promise<PendingProxyServer> {
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
		const externalUri = await vscode.env.asExternalUri(originUri);

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
					serverType,
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
	 * @param serverType The server type.
	 * @param app The express app.
	 * @param contentRewriter The content rewriter.
	 * @returns A promise that resolves when the proxy setup is complete.
	 */
	private async finishProxySetup(
		targetOrigin: string,
		serverOrigin: string,
		externalUri: vscode.Uri,
		server: Server,
		serverType: ProxyServerType,
		app: express.Express,
		contentRewriter: ContentRewriter
	) {
		log.debug(`Finishing proxy server setup for target ${targetOrigin}\n` +
			`\tserverOrigin: ${serverOrigin}\n` +
			`\texternalUri: ${externalUri.toString(true)}`
		);

		// Add the proxy server.
		this._proxyServers.set(targetOrigin, new ProxyServer(
			serverOrigin,
			targetOrigin,
			server,
			serverType
		));

		// Add the proxy middleware.
		app.use('*', (createProxyMiddleware as any)({
			target: targetOrigin,
			changeOrigin: true,
			selfHandleResponse: true,
			ws: true,
			on: {
				proxyReq: (proxyReq: any, req: any, res: any, _options: any) => {
					log.trace(`onProxyReq - proxy request ${serverOrigin}${req.url} -> ${targetOrigin}${req.url}` +
						`\n\tmethod: ${proxyReq.method}` +
						`\n\tprotocol: ${proxyReq.protocol}` +
						`\n\thost: ${proxyReq.host}` +
						`\n\turl: ${proxyReq.path}` +
						`\n\theaders: ${JSON.stringify(proxyReq.getHeaders())}` +
						`\n\texternal uri: ${externalUri.toString(true)}`
					);
				},
				proxyRes: responseInterceptor(async (responseBuffer: any, proxyRes: any, req: any, _res: any) => {
					log.trace(`onProxyRes - proxy response ${targetOrigin}${req.url} -> ${serverOrigin}${req.url}` +
						`\n\tstatus: ${proxyRes.statusCode}` +
						`\n\tstatusMessage: ${proxyRes.statusMessage}` +
						`\n\theaders: ${JSON.stringify(proxyRes.headers)}` +
						`\n\texternal uri: ${externalUri.toString(true)}`
					);

					// Get the URL and the content type. These must be present to call the
					// content rewriter. Also, the scripts must be loaded.
					const url = req.url;
					const contentType = proxyRes.headers['content-type'];
					const serverType = this._proxyServers.get(targetOrigin)?.serverType;
					const scriptsLoaded = this.resourcesLoadedForServerType(serverType);
					if (!url || !contentType || !scriptsLoaded) {
						log.trace(`onProxyRes - skipping response processing for ${serverOrigin}${url}`);
						// Don't process the response.
						return responseBuffer;
					}

					// Get the HTML configuration.
					const htmlConfig = serverType === ProxyServerType.Help
						? this._proxyServerHtmlConfigs.help
						: this._proxyServerHtmlConfigs.preview;

					// Rewrite the content.
					return contentRewriter(
						serverOrigin,
						externalUri.path,
						url,
						contentType,
						responseBuffer,
						htmlConfig
					);
				}),
			},
		}));
	}

	/**
	 * Checks if the resources are loaded for the server type.
	 * @param serverType The server type.
	 * @returns Whether the scripts are loaded.
	 */
	private resourcesLoadedForServerType(serverType: ProxyServerType | undefined): boolean {
		switch (serverType) {
			case ProxyServerType.Help:
				return this._proxyServerHtmlConfigs.help.resourcesLoaded();
			case ProxyServerType.Preview:
				// Check if the resources are loaded when running in the Web.
				if (vscode.env.uiKind === vscode.UIKind.Web) {
					return this._proxyServerHtmlConfigs.preview.resourcesLoaded();
				}
				return true;
			default:
				console.log(`Can't check if resources are loaded for unknown server type: ${serverType}`);
				return false;
		}
	}

	//#endregion Private Methods
}
