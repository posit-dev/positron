/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DefaultApi, HttpBearerAuth, HttpError, ServerStatus } from './kcclient/api';
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
		}).catch((err) => {
			vscode.window.showErrorMessage(`Failed to start Jupyter kernel supervisor.\n\n ${JSON.stringify(err)}`);
			this._log.error(`Failed to start Kallichore: ${err}`);
		});
	}

	/**
	 * Starts a new Kallichore server. If a server is already running, it will
	 * attempt to reconnect to it. Returns a promise that resolves when the
	 * server is online.
	 *
	 * @throws An error if the server cannot be started or reconnected to.
	 */
	async start() {
		// Check to see if there's a server already running for this workspace
		const serverState =
			this._context.workspaceState.get<KallichoreServerState>(KALLICHORE_STATE_KEY);

		// If there is, and we can reconnect to it, do so
		if (serverState) {
			try {
				if (await this.reconnect(serverState)) {
					// Successfully reconnected
					return;
				} else {
					// Did not reconnect; start a new server. This isn't
					// necessarily an error condition since we always try to
					// reconnect to the server saved in the state, and it's
					// normal for it to have exited if this is a new Positron
					// session.
					this._log.info(`Could not reconnect to Kallichore server ` +
						`at ${serverState.base_path}. Starting a new server`);
				}
			} catch (err) {
				this._log.error(`Failed to reconnect to Kallichore server ` +
					` at ${serverState.base_path}: ${err}. Starting a new server.`);
			}
		}

		// Get the path to the Kallichore server binary. This will throw an
		// error if the server binary cannot be found.
		const shellPath = this.getKallichorePath();


		// Get the log level from the configuration
		const config = vscode.workspace.getConfiguration('kallichoreSupervisor');
		const logLevel = config.get<string>('logLevel') ?? 'warn';

		// Export the Positron version as an environment variable
		const env = {
			'POSITRON': '1',
			'POSITRON_VERSION': positron.version,
			'RUST_LOG': logLevel,
			'POSITRON_LONG_VERSION': `${positron.version}+${positron.buildNumber}`,
			'POSITRON_MODE': vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'server',
		};

		// Create a 16 hex digit UUID for the bearer token
		const bearerToken = Math.floor(Math.random() * 0x100000000).toString(16);

		// Write it to a temporary file. Kallichore will delete it after reading
		// the secret.
		const tokenPath = path.join(os.tmpdir(), `kallichore-${bearerToken}.token`);
		fs.writeFileSync(tokenPath, bearerToken, 'utf8');

		// Change the permissions on the file so only the current user can read it
		fs.chmodSync(tokenPath, 0o600);

		// Create a bearer auth object with the token
		const bearer = new HttpBearerAuth();
		bearer.accessToken = bearerToken;

		// Find a port for the server to listen on
		const port = await findAvailablePort([], 10);

		// Start a timer so we can track server startup time
		const startTime = Date.now();

		// Start the server in a new terminal
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

		// Wait for the terminal to start and get the PID
		await terminal.processId;

		// Establish the API
		this._api.basePath = `http://localhost:${port}`;
		this._api.setDefaultAuthentication(bearer);

		// List the sessions to verify that the server is up. The process is
		// alive for a few milliseconds before the HTTP server is ready, so we
		// may need to retry a few times.
		for (let retry = 0; retry < 40; retry++) {
			try {
				const status = await this._api.serverStatus();
				this._log.info(`Kallichore ${status.body.version} server online with ${status.body.sessions} sessions`);
				break;
			} catch (err) {
				// ECONNREFUSED is a normal condition; the server isn't ready
				// yet. Keep trying until we hit the retry limit, about 2
				// seconds from the time we got a process ID established.
				if (err.code === 'ECONNREFUSED') {
					if (retry < 19) {
						// Wait a bit and try again
						await new Promise((resolve) => setTimeout(resolve, 50));
						continue;
					} else {
						// Give up; it shouldn't take this long to start
						this._log.error(`Kallichore server did not start after ${Date.now() - startTime}ms`);
						throw new Error(`Kallichore server did not start after ${Date.now() - startTime}ms`);
					}
				}
				this._log.error(`Failed to get session list from Kallichore; ` +
					`server may not be running or may not be ready. Check the terminal for errors. ` +
					`Error: ${JSON.stringify(err)}`);
				throw err;
			}
		}

		// Open the started barrier and save the server state since we're online
		this._log.debug(`Kallichore server started in ${Date.now() - startTime}ms`);
		this._started.open();
		const state: KallichoreServerState = {
			base_path: this._api.basePath,
			port,
			server_path: shellPath,
			server_pid: await terminal.processId || 0,
			bearer_token: bearerToken
		};
		this._context.workspaceState.update(KALLICHORE_STATE_KEY, state);
	}

	/**
	 * Attempt to reconnect to a Kallichore server that was previously running.
	 *
	 * @param serverState The state of the server to reconnect to.
	 * @returns True if the server was successfully reconnected, false if the
	 *  server was not running.
	 * @throws An error if the server was running but could not be reconnected.
	 */
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
		const status = await this._api.serverStatus();
		this._started.open();
		this._log.info(`Kallichore ${status.body.version} server reconnected with ${status.body.sessions} sessions`);
		return true;
	}

	/**
	 * Create a new session for a Jupyter-compatible kernel.
	 *
	 * @param runtimeMetadata The metadata for the associated language runtime
	 * @param sessionMetadata The metadata for this specific kernel session
	 * @param kernel The Jupyter kernel spec for the kernel to be started
	 * @param dynState The kernel's initial dynamic state
	 * @param _extra Extra functionality for the kernel
	 *
	 * @returns A promise that resolves to the new session
	 * @throws An error if the session cannot be created
	 */
	async createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		kernel: JupyterKernelSpec,
		dynState: positron.LanguageRuntimeDynState,
		_extra?: JupyterKernelExtra | undefined): Promise<JupyterLanguageRuntimeSession> {

		// Create the session object
		const session = new KallichoreSession(
			sessionMetadata, runtimeMetadata, dynState, this._api, true);

		// Wait for the server to start before creating the session
		await this._started.wait();

		this._log.info(`Creating session: ${JSON.stringify(sessionMetadata)}`);

		// Create the session on the server
		await session.create(kernel);

		// Save the session now that it has been created on the server
		this._sessions.push(session);

		return session;
	}

	/**
	 * Restores (reconnects to) an already running session on the Kallichore
	 * server.
	 *
	 * @param runtimeMetadata The metadata for the associated language runtime
	 * @param sessionMetadata The metadata for the session to be restored
	 * @returns The restored session
	 */
	async restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Promise<JupyterLanguageRuntimeSession> {

		return new Promise<JupyterLanguageRuntimeSession>((resolve, reject) => {
			this._api.getSession(sessionMetadata.sessionId).then(async (response) => {
				// Create the session object
				const kcSession = response.body;
				const session = new KallichoreSession(sessionMetadata, runtimeMetadata, {
					continuationPrompt: kcSession.continuationPrompt,
					inputPrompt: kcSession.inputPrompt,
				}, this._api, false);

				// Restore the session from the server
				try {
					session.restore(kcSession);
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
	 * Gets the status of the Kallichore server.
	 *
	 * @returns The server status.
	 */
	public async serverStatus(): Promise<ServerStatus> {
		const status = await this._api.serverStatus();
		return status.body;
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

		const path = require('path');
		const fs = require('fs');

		// Get the name of the server binary for the current platform
		const serverBin = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';

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
		const embeddedBinary = path.join(
			this._context.extensionPath, 'resources', 'kallichore', serverBin);
		if (fs.existsSync(embeddedBinary)) {
			return embeddedBinary;
		}

		throw new Error(`Kallichore server not found (expected at ${embeddedBinary})`);
	}
}
