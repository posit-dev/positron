/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import { LanguageRuntimeMetadata, RuntimeSessionMetadata, LanguageRuntimeDynState } from 'positron';
import { DefaultApi } from './kcclient/api';
import { findAvailablePort } from './PortFinder';
import { KallichoreAdapterApi } from './kallichore-adapter';
import { JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { KallichoreSession } from './session';

export class KCApi implements KallichoreAdapterApi {
	private readonly _api: DefaultApi;
	constructor(private readonly _context: vscode.ExtensionContext, private readonly _log: vscode.LogOutputChannel) {
		this._api = new DefaultApi();
		this.start().then(() => {
			this._log.info('Kallichore started');
		});
	}

	async start() {
		// TODO: re-use existing terminal instead of opening a new one every time;
		// can do this by attempting a network reconnect
		const kcExeName = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';
		const shellPath = path.join(this._context.extensionPath, 'resources', 'kallichore', kcExeName);
		const env = {
			POSITRON: '1',
			POSITRON_VERSION: positron.version,
			RUST_LOG: 'debug'
		};


		// Find a port for the server to listen on
		const port = await findAvailablePort([], 10);

		this._log.info(`Starting Kallichore server ${shellPath} on port ${port}`);
		vscode.window.createTerminal(<vscode.TerminalOptions>{
			name: 'Kallichore',
			shellPath: shellPath,
			shellArgs: ['--port', port.toString()],
			env,
			message: '',
			hideFromUser: false,
			isTransient: false
		});
		// wait 1s for the server to start up
		setTimeout(() => {
			this._api.basePath = `http://localhost:${port}`;
			this._api.listSessions().then(sessions => {
				this._log.info(`Kallichore server online with ${sessions.body.total} sessions`);
			});
		}, 1000);
	}

	createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, kernel: JupyterKernelSpec, dynState: LanguageRuntimeDynState, _extra?: JupyterKernelExtra | undefined): JupyterLanguageRuntimeSession {
		this._log.info(`Creating session: ${JSON.stringify(sessionMetadata)}`);
		return new KallichoreSession(sessionMetadata, runtimeMetadata, dynState, kernel, this._log, this._api);
	}
	restoreSession(_runtimeMetadata: LanguageRuntimeMetadata, _sessionMetadata: RuntimeSessionMetadata): JupyterLanguageRuntimeSession {
		this._log.info(`Restoring session: ${JSON.stringify(_sessionMetadata)}`);
		throw new Error('Method not implemented.');
	}
	dispose() {
		throw new Error('Method not implemented.');
	}

	findAvailablePort(_excluding: Array<number>, _maxTries: number): Promise<number> {
		throw new Error('Method not implemented.');
	}
}
