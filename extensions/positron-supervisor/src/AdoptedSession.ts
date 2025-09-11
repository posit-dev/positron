/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterKernel, JupyterSession } from './positron-supervisor.d';
import { KallichoreSession } from './KallichoreSession';
import { KernelInfoReply } from './jupyter/KernelInfoRequest';
import { ConnectionInfo, DefaultApi } from './kcclient/api';
import { summarizeAxiosError } from './util';
import { Barrier } from './async';

/**
 * Represents a Jupyter kernel that has been adopted by a supervisor. These
 * sessions are typically started outside the control of the supervisor, and
 * then adopted by the supervisor once started.
 *
 * Currently, only Reticulate kernels use this mechanism.
 */
export class AdoptedSession implements JupyterKernel {
	private _runtimeInfo: KernelInfoReply | undefined;

	/// Whether the session is connected (or the connection has failed)
	public connected = new Barrier();

	/**
	 * Create a new adopted session.
	 *
	 * @param _session The Kallichore session
	 * @param _connectionInfo The connection information for the adopted session
	 * @param _api The Kallichore API instance
	 */
	constructor(
		private readonly _session: KallichoreSession,
		private readonly _connectionInfo: ConnectionInfo,
		private readonly _api: DefaultApi
	) {

	}

	/**
	 * Connect to (adopt) the given session.
	 *
	 * @param session The session to connect to
	 */
	async connectToSession(session: JupyterSession): Promise<void> {
		try {
			// Adopt the session via the API, using the connection information
			this._runtimeInfo = (await this._api.adoptSession(session.state.sessionId, this._connectionInfo)).data;
		} catch (err) {
			const message = err.message;
			throw new Error(`Failed to adopt session: ${message}`);
		} finally {
			// Open the connected barrier to indicate we've finished connecting
			// (or failed to)
			this.connected.open();
		}
	}

	/**
	 * Get the runtime information for the kernel. We know this information
	 * only if the session is connected.
	 */
	get runtimeInfo(): KernelInfoReply | undefined {
		return this._runtimeInfo;
	}

	/**
	 * Log a message to the session's output log.
	 *
	 * @param msg The message to log
	 */
	log(msg: string): void {
		this._session.log(msg);
	}
}
