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
import { ConnectionInfo, DefaultApi } from './kcclient/api';

export class AdoptedSession implements JupyterKernel {
	private _runtimeInfo: KernelInfoReply | undefined;

	constructor(
		private readonly _session: KallichoreSession,
		private readonly _api: DefaultApi
	) {

	}

	async connectToSession(session: JupyterSession): Promise<void> {
		const connectionFile = session.state.connectionFile;
		// Read the contents of the file from disk
		const connectionInfo = fs.readFileSync(connectionFile, 'utf-8');

		// Adopt the session using the connection information
		this._api.adoptSession(session.state.sessionId, connectionInfo);
	}

	get runtimeInfo(): KernelInfoReply | undefined {
		return this._runtimeInfo;
	}

	log(msg: string): void {
		this._session.log(msg);
	}
}
