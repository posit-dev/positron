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

/**
 * Wraps an instance of the code-generated `DefaultApi` object.
 */
export class KallichoreApiInstance {

	/** The API instance itself */
	private _api: DefaultApi | undefined;

	/** The current server state, if any */
	private _serverState: KallichoreServerState | undefined;

	/** The transport mechanism used by the API */
	private _transport: KallichoreTransport;

	constructor(transport: KallichoreTransport) {
		this._transport = transport;
	}

	/**
	 * Gets the API instance.
	 *
	 * Must not be called until the API has been created; throws if this happens.
	 */
	get api(): DefaultApi {
		if (!this._api) {
			throw new Error('API has not been created.');
		}
		return this._api;
	}

	/**
	 * Get the transport mechanism used by the API.
	 */
	get transport(): KallichoreTransport {
		return this._transport;
	}

	/**
	 * Get the current server state, if any.
	 */
	get state(): KallichoreServerState | undefined {
		return this._serverState;
	}

	/**
	 * Creates the API from the given server state.
	 *
	 * @param state The server state
	 */
	public loadState(state: KallichoreServerState) {

		// Load the server state
		if (state.transport) {
			this._transport = state.transport;
		}
		this._serverState = state;

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
