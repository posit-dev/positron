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
import { Barrier } from './barrier';

export class KCApi implements KallichoreAdapterApi {
	private readonly _api: DefaultApi;
	private readonly _started: Barrier = new Barrier();
	constructor(private readonly _context: vscode.ExtensionContext, private readonly _log: vscode.LogOutputChannel) {
		this._api = new DefaultApi();
		this.start().then(() => {
			this._log.info('Kallichore started');
		});
	}

	async start() {
		// TODO: re-use existing terminal instead of opening a new one every time;
		// can do this by attempting a network reconnect

		const shellPath = this.getKallichorePath();
		const env = {
			'POSITRON': '1',
			'POSITRON_VERSION': positron.version,
			'RUST_LOG': 'debug'
		};


		// Find a port for the server to listen on
		const port = await findAvailablePort([], 10);

		this._log.info(`Starting Kallichore server ${shellPath} on port ${port}`);
		vscode.window.createTerminal(<vscode.TerminalOptions>{
			name: 'Kallichore',
			shellPath: shellPath,
			shellArgs: ['--port', port.toString()],
			env,
			message: `*** Kallichore Server (${shellPath}) ***`,
			hideFromUser: false,
			isTransient: false
		});
		// wait 1s for the server to start up
		setTimeout(() => {
			this._api.basePath = `http://localhost:${port}`;
			this._api.listSessions().then(sessions => {
				this._started.open();
				this._log.info(`Kallichore server online with ${sessions.body.total} sessions`);
			});
		}, 1000);
	}

	createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, kernel: JupyterKernelSpec, dynState: LanguageRuntimeDynState, _extra?: JupyterKernelExtra | undefined): JupyterLanguageRuntimeSession {
		this._log.info(`Creating session: ${JSON.stringify(sessionMetadata)}`);

		// Create the session object
		const session = new KallichoreSession(sessionMetadata, runtimeMetadata, dynState, kernel, this._context, this._log, this._api);

		// Wait for the server to start before creating the session on the backend
		this._started.wait().then(async () => {
			await session.create();
		});

		return session;
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


	/**
	 * Attempts to locate a copy of the Kallichore server binary.
	 *
	 * @returns A path to the Kallichore server binary.
	 * @throws An error if the server binary cannot be found.
	 */
	getKallichorePath(): string {

		const serverBin = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';
		const path = require('path');
		const fs = require('fs');

		// Look for locally built Debug or Release server binaries. If both exist, we'll use
		// whichever is newest. This is the location where the kernel is typically built
		// by developers, who have `positron` and `kallichore` directories side-by-side.
		let devBinary = undefined;
		const positronParent = path.dirname(path.dirname(path.dirname(this._context.extensionPath)));
		const devDebugBinary = path.join(positronParent, 'kallichore', 'target', 'debug', serverBin);
		const devReleaseBinary = path.join(positronParent, 'kallichore', 'target', 'release', serverBin);
		const debugModified = fs.statSync(devDebugBinary, { throwIfNoEntry: false })?.mtime;
		const releaseModified = fs.statSync(devReleaseBinary, { throwIfNoEntry: false })?.mtime;

		if (debugModified) {
			devBinary = (releaseModified && releaseModified > debugModified) ? devReleaseBinary : devDebugBinary;
		} else if (releaseModified) {
			devBinary = devReleaseBinary;
		}
		if (devBinary) {
			this._log.info(`Loading Kallichore from disk in adjacent repository (${devBinary}). Make sure it's up-to-date.`);
			return devBinary;
		}

		// Now try the default (embedded) kernel. This is where the kernel is placed in
		// development and release builds.
		const embeddedBinary = path.join(this._context.extensionPath, 'resources', 'ark', serverBin);
		if (fs.existsSync(embeddedBinary)) {
			return embeddedBinary;
		}

		throw new Error(`Kallichore server not found (expected at ${embeddedBinary})`);
	}
}
