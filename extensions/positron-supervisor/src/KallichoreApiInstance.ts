/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultApi } from './kcclient/api.js';
import { Configuration } from './kcclient/configuration.js';
import { namedPipeInterceptor } from './NamedPipeHttpAgent.js';
import { KallichoreServerState } from './ServerState.js';

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

		// Create the API instance
		this._api = new DefaultApi(
			new Configuration({
				// This access token is currently not used by the Axios
				// template, but may be required in the future
				accessToken: state.bearer_token,
				baseOptions: {
					// For domain socket connections, we need to specify the
					// socket path in the HTTP client options
					socketPath: state.socket_path,

					// Disable proxy processing entirely. Today it's only
					// possible to run Kallichore locally, so we always want to
					// skip proxies when connecting. This may need to be
					// revisited in the future if we support remote connections.
					proxy: false,

					// Include the bearer token auth on each request
					headers: {
						Authorization: `Bearer ${state.bearer_token}`
					}
				},
			}),
			state.base_path
		);

		// Add interceptor for named pipe support on Windows. This interceptor
		// allows us to perform HTTP over named pipes, which is not natively
		// supported by the HTTP client in Node.js.
		//
		// Note that the interceptor doesn't always use named pipes; it just gives us
		// the ability to do so.
		if (os.platform() === 'win32') {
			(this._api as any).interceptors.push(namedPipeInterceptor);
		}
	}

}
