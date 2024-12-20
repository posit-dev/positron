/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as fs from 'fs';
import { JupyterKernel, JupyterSession } from './jupyter-adapter';
import { KallichoreSession } from './KallichoreSession';
import { KernelInfoReply } from './jupyter/KernelInfoRequest';
import { KallichoreAdapterApi } from './positron-supervisor';
import { ConnectionInfo, DefaultApi, HttpError } from './kcclient/api';
import { summarizeHttpError } from './util';
import { Barrier } from './async';

export class AdoptedSession implements JupyterKernel {
	private _runtimeInfo: KernelInfoReply | undefined;

	public connected = new Barrier();

	constructor(
		private readonly _session: KallichoreSession,
		private readonly _connectionInfo: ConnectionInfo,
		private readonly _api: DefaultApi
	) {

	}

	async connectToSession(session: JupyterSession): Promise<void> {
		// Adopt the session using the connection information
		try {
			this._runtimeInfo = (await this._api.adoptSession(session.state.sessionId, this._connectionInfo)).body;
		} catch (err) {
			const message = err instanceof HttpError ? summarizeHttpError(err) : err.message;
			throw new Error(`Failed to adopt session: ${message}`);
		} finally {
			this.connected.open();
		}
	}

	get runtimeInfo(): KernelInfoReply | undefined {
		return this._runtimeInfo;
	}

	log(msg: string): void {
		this._session.log(msg);
	}
}
