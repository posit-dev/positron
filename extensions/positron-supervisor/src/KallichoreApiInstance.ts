/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultApi } from './kcclient/api.js';
import { Configuration } from './kcclient/configuration.js';
import { createHttpAgent } from './NamedPipeHttpAgent.js';
import { KallichoreServerState } from './ServerState.js';
import axios, { AxiosInstance } from 'axios';

import * as os from 'os';

export enum KallichoreTransport {
	TCP = 'tcp',
	UnixSocket = 'socket',
	NamedPipe = 'named-pipe',
}

export class KallichoreApiInstance {

	private _api: DefaultApi | undefined;

	private _transport: KallichoreTransport;

	constructor() {
		this._transport = KallichoreTransport.TCP;
	}

	get api(): DefaultApi {
		return this._api!;
	}

	get transport(): KallichoreTransport {
		return this._transport;
	}

	/**
	 * Creates the API from the given server state.
	 *
	 * @param state The server state
	 */
	public loadState(state: KallichoreServerState) {

		// Determine the transport
		if (state.base_path) {
			this._transport = KallichoreTransport.TCP;
		} else if (state.socket_path) {
			this._transport = KallichoreTransport.UnixSocket;
		} else if (state.named_pipe) {
			this._transport = KallichoreTransport.NamedPipe;
		} else {
			throw new Error('Server state missing base_path, socket_path, and named_pipe');
		}

		// Common base options used for all connections
		const baseOptions = {
			// For domain socket connections, we need to specify the
			// socket path in the HTTP client options
			socketPath: state.socket_path,

			// Disable proxy processing entirely. Today it's only
			// possible to run Kallichore locally, so we always want to
			// skip proxies when connecting. This may need to be
			// revisited in the future if we support remote connections.
			proxy: false as const,

			// Include the bearer token auth on each request
			headers: {
				Authorization: `Bearer ${state.bearer_token}`
			}
		};

		let basePath = state.base_path;
		let axiosInstance: AxiosInstance | undefined;

		// Handle named pipe connections specially on Windows
		if (this._transport === KallichoreTransport.NamedPipe && state.named_pipe && os.platform() === 'win32') {
			// Create a special base path for named pipes that the HTTP agent can recognize
			basePath = `http://npipe:${state.named_pipe}:`;

			// Create custom axios instance with named pipe agent
			const httpAgent = createHttpAgent(basePath);
			if (httpAgent) {
				axiosInstance = axios.create({
					httpAgent: httpAgent,
					...baseOptions
				});

				// Add request interceptor to transform URLs from npipe: format to localhost
				axiosInstance.interceptors.request.use((config) => {
					if (config.url && config.url.includes('npipe:')) {
						// Transform URL from http://npipe:pipename:/path to http://localhost/path
						const pathMatch = config.url.match(/npipe:[^:]+:(\/.*)/);
						const path = pathMatch ? pathMatch[1] : '/';
						config.url = `http://localhost${path}`;
					}
					return config;
				});
			}
		}

		// Create the API instance
		this._api = new DefaultApi(
			new Configuration({
				// This access token is currently not used by the Axios
				// template, but may be required in the future
				accessToken: state.bearer_token,
				baseOptions,
			}),
			basePath,
			axiosInstance // Use custom axios instance for named pipes, undefined for others
		);
	}

}
