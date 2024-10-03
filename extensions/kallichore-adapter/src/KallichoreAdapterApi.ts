/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { LanguageRuntimeMetadata, RuntimeSessionMetadata, LanguageRuntimeDynState } from 'positron';
import { DefaultApi, HttpBasicAuth, HttpBearerAuth, HttpError } from './kcclient/api';
import { findAvailablePort } from './PortFinder';
import { KallichoreAdapterApi } from './kallichore-adapter';
import { JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { KallichoreSession } from './KallichoreSession';
import { Barrier } from './async';

const KALLICHORE_STATE_KEY = 'kallichore-adapter.v2';

/**
 * The persisted state of the Kallichore server. This metadata is saved in
 * workspace state storage and used to re-establish a connection to the server
 * when the extension (or Positron) is reloaded.
 */
interface KallichoreServerState {
	/** The port the server is listening on, e.g. 8182 */
	port: number;

	/** The full base path of the API, e.g. http://127.0.0.1:8182/ */
	base_path: string;

	/** The path to the server binary, e.g. /usr/lib/bin/kcserver. */
	server_path: string;

	/** The PID of the server process */
	server_pid: number;

	/** The bearer token used to authenticate with the server */
	bearer_token: string;
}

export class KCApi implements KallichoreAdapterApi {

	/** The instance of the API; the API is code-generated from the Kallichore
	 * OpenAPI spec */
	private readonly _api: DefaultApi;

	/** A barrier that opens when the Kallichore server has successfully started;
	 * used to hold operations until we're online */
	private readonly _started: Barrier = new Barrier();

	/** The currently active sessions (only the ones used by this client; does
	 * not track the full set of sessions on the Kallichore server) */
	private readonly _sessions: Array<KallichoreSession> = [];

	/**
	 * Create a new Kallichore API object.
	 *
	 * @param _context The extension context
	 * @param _log A log output channel for the extension
	 */
	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: vscode.LogOutputChannel) {

		this._api = new DefaultApi();
		this.start().then(() => {
			this._log.info('Kallichore started');
		});
	}

	async start() {
		// Check to see if there's a server already running for this workspace
		const serverState = this._context.workspaceState.get<KallichoreServerState>(KALLICHORE_STATE_KEY);

		// If there is, and we can reconnect to it, do so
		if (serverState) {
			try {
				if (await this.reconnect(serverState)) {
					return;
				} else {
					this._log.warn(`Could not reconnect to Kallichore server at ${serverState.base_path}. Starting a new server`);
				}
			} catch (err) {
				this._log.error(`Failed to reconnect to Kallichore server at ${serverState.base_path}: ${err}. Starting a new server.`);
			}
		}

		const shellPath = this.getKallichorePath();
		const env = {
			'POSITRON': '1',
			'POSITRON_VERSION': positron.version,
			'RUST_LOG': 'debug'
		};

		// Create a 16 hex digit UUID for the bearer token
		const bearerToken = Math.floor(Math.random() * 0x100000000).toString(16);

		// Write it to a temporary file using the fs module. Kallichore will
		// delete it when it's done.
		const tokenPath = path.join(os.tmpdir(), `kallichore-${bearerToken}.token`);
		fs.writeFileSync(tokenPath, bearerToken, 'utf8');

		// Change the permissions on the file so only the current user can read it
		fs.chmodSync(tokenPath, 0o600);

		// Create a bearer auth object with the token
		const bearer = new HttpBearerAuth();
		bearer.accessToken = bearerToken;

		// Find a port for the server to listen on
		const port = await findAvailablePort([], 10);

		this._log.info(`Starting Kallichore server ${shellPath} on port ${port}`);
		const terminal = vscode.window.createTerminal(<vscode.TerminalOptions>{
			name: 'Kallichore',
			shellPath: shellPath,
			shellArgs: ['--port', port.toString(), '--token', tokenPath],
			env,
			message: `*** Kallichore Server (${shellPath}) ***`,
			hideFromUser: false,
			isTransient: false
		});

		// wait 500ms for the server to start up (TODO: there has to be faster way to do this)
		setTimeout(() => {
			this._api.basePath = `http://localhost:${port}`;
			this._api.setDefaultAuthentication(bearer);
			this._api.listSessions().then(async sessions => {
				this._started.open();
				const state: KallichoreServerState = {
					base_path: this._api.basePath,
					port,
					server_path: shellPath,
					server_pid: await terminal.processId || 0,
					bearer_token: bearerToken
				};
				this._context.workspaceState.update(KALLICHORE_STATE_KEY, state);
				this._log.info(`Kallichore server online with ${sessions.body.total} sessions`);
			});
		}, 500);
	}

	async reconnect(serverState: KallichoreServerState): Promise<boolean> {
		// Check to see if the pid is still running
		const pid = serverState.server_pid;
		this._log.info(`Reconnecting to Kallichore server at ${serverState.base_path} (PID ${pid})`);
		if (pid) {
			try {
				process.kill(pid, 0);
			} catch (err) {
				this._log.warn(`Kallichore server PID ${pid} is not running`);
				return false;
			}
		}

		// Re-establish the bearer token
		const bearer = new HttpBearerAuth();
		bearer.accessToken = serverState.bearer_token;
		this._api.setDefaultAuthentication(bearer);

		// Reconnect and get the session list
		this._api.basePath = serverState.base_path;
		const sessions = await this._api.listSessions();
		this._started.open();
		this._log.info(`Kallichore server online with ${sessions.body.total} sessions`);
		return true;
	}

	async createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: RuntimeSessionMetadata, kernel: JupyterKernelSpec, dynState: LanguageRuntimeDynState, _extra?: JupyterKernelExtra | undefined): Promise<JupyterLanguageRuntimeSession> {
		this._log.info(`Creating session: ${JSON.stringify(sessionMetadata)}`);

		// Create the session object
		const session = new KallichoreSession(sessionMetadata, runtimeMetadata, dynState, this._api, true);

		// Wait for the server to start
		await this._started.wait();

		// Create the session on the server
		await session.create(kernel);

		// Save the session
		this._sessions.push(session);

		return session;
	}

	async restoreSession(
		runtimeMetadata: LanguageRuntimeMetadata,
		sessionMetadata: RuntimeSessionMetadata): Promise<JupyterLanguageRuntimeSession> {
		const session = new KallichoreSession(sessionMetadata, runtimeMetadata, {
			// TODO: Store these in session state or something
			continuationPrompt: '+',
			inputPrompt: '>',
		}, this._api, false);

		return new Promise<JupyterLanguageRuntimeSession>((resolve, reject) => {
			this._api.getSession(sessionMetadata.sessionId).then(async (response) => {
				try {
					session.restore(response.body);
				} catch (err) {
					this._log.error(`Failed to restore session ${sessionMetadata.sessionId}: ${JSON.stringify(err)}`);
					reject(err);
				}
				// Save the session
				this._sessions.push(session);
				resolve(session);
			}).catch((err) => {
				if (err instanceof HttpError) {
					this._log.error(`Failed to reconnect to session ${sessionMetadata.sessionId}: ${err.body.message}`);
					reject(err.body.message);
				} else {
					this._log.error(`Failed to reconnect to session ${sessionMetadata.sessionId}: ${JSON.stringify(err)}`);
					reject(err);
				}
			});
		});
	}

	/**
	 * Clean up the Kallichore server and all sessions. Note that this doesn't
	 * actually remove the sessions from the server; it just disconnects them
	 * from the API.
	 */
	dispose() {
		// Dispose of each session
		this._sessions.forEach(session => session.dispose());
		this._sessions.length = 0;
	}

	findAvailablePort(excluding: Array<number>, maxTries: number): Promise<number> {
		return findAvailablePort(excluding, maxTries);
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
