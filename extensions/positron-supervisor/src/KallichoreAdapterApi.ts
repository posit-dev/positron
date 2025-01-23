/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DefaultApi, HttpBearerAuth, HttpError, ServerStatus, Status } from './kcclient/api';
import { findAvailablePort } from './PortFinder';
import { KallichoreAdapterApi } from './positron-supervisor';
import { JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { KallichoreSession } from './KallichoreSession';
import { Barrier, PromiseHandles, withTimeout } from './async';
import { LogStreamer } from './LogStreamer';
import { createUniqueId, summarizeError, summarizeHttpError } from './util';

const KALLICHORE_STATE_KEY = 'positron-supervisor.v1';

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

	/** The path to the log file */
	log_path: string;
}

export class KCApi implements KallichoreAdapterApi {

	/** The instance of the API; the API is code-generated from the Kallichore
	 * OpenAPI spec */
	private readonly _api: DefaultApi;

	/** A barrier that opens when the Kallichore server has successfully started;
	 * used to hold operations until we're online */
	private _started: Barrier = new Barrier();

	/**
	 * If we're currently starting, this is the promise that resolves when the
	 * server is online.
	 */
	private _starting: PromiseHandles<void> | undefined;

	/** The currently active sessions (only the ones used by this client; does
	 * not track the full set of sessions on the Kallichore server) */
	private readonly _sessions: Array<KallichoreSession> = [];

	/**
	 * The streamer for the Kallichore server logs
	 */
	private _logStreamer: LogStreamer | undefined;

	/**
	 * An array of disposables that need to be cleaned up when the API is disposed.
	 */
	private _disposables: vscode.Disposable[] = [];

	/**
	 * The terminal hosting the server, if we know it. We only know the
	 * terminal if it has been started in this session; reconnecting to an
	 * existing server doesn't give us the terminal.
	 */
	private _terminal: vscode.Terminal | undefined;

	/**
	 * Whether the server is a new server that was just started in this
	 * Positron session.
	 */
	private _newSupervisor = true;

	/**
	 * Create a new Kallichore API object.
	 *
	 * @param _context The extension context
	 * @param _log A log output channel for the extension
	 */
	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: vscode.OutputChannel) {

		this._api = new DefaultApi();

		// If the Kallichore server is enabled in the configuration, start it
		// eagerly so it's warm when we start trying to create or restore sessions.
		if (vscode.workspace.getConfiguration('kernelSupervisor').get<boolean>('enable', true)) {
			this.ensureStarted().catch((err) => {
				this._log.appendLine(`Failed to start Kallichore server: ${err}`);
			});
		}

		_context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.reconnectSession', () => {
			this.reconnectActiveSession();
		}));

		_context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.restartSupervisor', () => {
			this.restartSupervisor();
		}));
	}

	/**
	 * Ensures that the server has been started. If the server is already
	 * started, this is a no-op. If the server is starting, this waits for the
	 * server to start. If the server is not started, this starts the server.
	 *
	 * @returns A promise that resolves when the Kallichore server is online.
	 */
	public async ensureStarted(): Promise<void> {

		// If the server is already started, we're done
		if (this._started.isOpen()) {
			return;
		}

		// If we're currently starting, just wait for that to finish
		if (this._starting) {
			return this._starting.promise;
		}

		// Create a new starting promise and start the server
		this._starting = new PromiseHandles<void>();
		this.start().then(() => {
			this._starting?.resolve();
			this._starting = undefined;
		}).catch((err) => {
			this._starting?.reject(err);
			this._starting = undefined;
		});
		return this._starting.promise;
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
					this._log.appendLine(`Could not reconnect to Kallichore server ` +
						`at ${serverState.base_path}. Starting a new server`);
				}
			} catch (err) {
				this._log.appendLine(`Failed to reconnect to Kallichore server ` +
					` at ${serverState.base_path}: ${err}. Starting a new server.`);
			}
		}

		// Get the path to the Kallichore server binary. This will throw an
		// error if the server binary cannot be found.
		const shellPath = this.getKallichorePath();


		// Get the log level from the configuration
		const config = vscode.workspace.getConfiguration('kernelSupervisor');
		const logLevel = config.get<string>('logLevel') ?? 'warn';

		// Export the Positron version as an environment variable
		const env = {
			'POSITRON': '1',
			'POSITRON_VERSION': positron.version,
			'RUST_LOG': logLevel,
			'POSITRON_LONG_VERSION': `${positron.version}+${positron.buildNumber}`,
			'POSITRON_MODE': vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'server',
		};

		// Create a server session ID (8 characters)
		const sessionId = createUniqueId();

		// Create unique bearer token for this session
		const bearerToken = createUniqueId() + createUniqueId();

		// Write it to a temporary file. Kallichore will delete it after reading
		// the secret.
		const tokenPath = path.join(os.tmpdir(), `kallichore-${sessionId}.token`);
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

		// Consult configuration to see if we should show this terminal
		const showTerminal = config.get<boolean>('showTerminal', true);

		// Create a temporary file with a random name to use for logs
		const logFile = path.join(os.tmpdir(), `kallichore-${sessionId}.log`);

		// Create a second file to capture the server's stdout and stderr
		const outFile = path.join(os.tmpdir(), `kallichore-${sessionId}.out.log`);

		// Determine the path to the wrapper script.
		const wrapperName = os.platform() === 'win32' ? 'supervisor-wrapper.bat' : 'supervisor-wrapper.sh';
		let wrapperPath = path.join(this._context.extensionPath, 'resources', wrapperName);

		// The first argument to the wrapper script is the path to the log file
		const shellArgs = [
			outFile
		];

		// Check to see if session persistence is enabled; if it is, we want to run the
		// server with nohup so it doesn't die when the terminal is closed.
		const shutdownTimeout = config.get<string>('shutdownTimeout', 'immediately');
		if (shutdownTimeout !== 'immediately') {
			const kernelWrapper = wrapperPath;
			if (os.platform() === 'win32') {
				// Use start /b on Windows to run the server in the background
				this._log.appendLine(`Running Kallichore server with 'start /b' to persist sessions`);
				wrapperPath = 'start';
				shellArgs.unshift('/b', kernelWrapper);
			} else {
				// Use nohup as the wrapper on Unix-like systems
				this._log.appendLine(`Running Kallichore server with nohup to persist sessions`);
				wrapperPath = 'nohup';
				shellArgs.unshift(kernelWrapper);
			}
		}

		// Add the path to Kallichore itself
		shellArgs.push(shellPath);
		shellArgs.push(...[
			'--port', port.toString(),
			'--token', tokenPath,
			'--log-level', logLevel,
			'--log-file', logFile,
		]);

		// Compute the appropriate value for the idle shutdown hours setting.
		//
		// This setting is primarily used in Remote SSH mode to allow kernel
		// sessions to persist even when Positron itself is closed. In this
		// scenario, we want keep the sessions alive for a period of time so
		// they are still running when the user reconnects to the remote host,
		// but we don't want them to run forever (unless the user wants to and
		// understands the implications).
		if (shutdownTimeout === 'immediately') {
			// In desktop mode, when not persisting sessions, set the idle
			// timeout to 1 hour. This is a defensive move since we generally
			// expect the server to exit when the enclosing terminal closes;
			// the 1 hour idle timeout ensures that it will eventually exit if
			// the process is orphaned for any reason.
			if (vscode.env.uiKind === vscode.UIKind.Desktop) {
				shellArgs.push('--idle-shutdown-hours', '1');
			}

			// In web mode, we do not set an idle timeout at all by default,
			// since it is normal for the front end to be disconnected for long
			// periods of time.
		} else if (shutdownTimeout === 'when idle') {
			// Set the idle timeout to 0 hours, which causes the server to exit
			// 30 seconds after the last session becomes idle.
			shellArgs.push('--idle-shutdown-hours', '0');
		} else if (shutdownTimeout !== 'indefinitely') {
			// All other values of this setting are numbers that we can pass
			// directly to the supervisor.
			try {
				// Attempt to parse the value as an integer
				const hours = parseInt(shutdownTimeout, 10);
				shellArgs.push('--idle-shutdown-hours', hours.toString());
			} catch (err) {
				// Should never happen since we provide all the values, but log
				// it if it does.
				this._log.appendLine(`Invalid hour value for kernelSupervisor.shutdownTimeout: '${shutdownTimeout}'; persisting sessions indefinitely`);
			}
		}

		// Start the server in a new terminal
		this._log.appendLine(`Starting Kallichore server ${shellPath} on port ${port}`);
		const terminal = vscode.window.createTerminal({
			name: 'Kallichore',
			shellPath: wrapperPath,
			shellArgs,
			env,
			message: `*** Kallichore Server (${shellPath}) ***`,
			hideFromUser: !showTerminal,
			isTransient: false
		} satisfies vscode.TerminalOptions);

		// Flag to track if the terminal exited before the start barrier opened
		let exited = false;

		// Listen for the terminal to close. If it closes unexpectedly before
		// the start barrier opens, provide some feedback.
		const closeListener = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
			// Ignore closed terminals that aren't the one we started
			if (closedTerminal !== terminal) {
				return;
			}

			// Ignore if the start barrier is already open (that means the
			// server started successfully), or if more than 5 minutes have elapsed
			if (this._started.isOpen()) {
				return;
			}

			// Ignore if it's been more than 5 minutes since the start time
			if (Date.now() - startTime > 300000) {
				return;
			}

			// Mark the terminal as exited
			exited = true;

			// Read the contents of the output file and log it
			const contents = fs.readFileSync(outFile, 'utf8');
			if (terminal.exitStatus && terminal.exitStatus.code) {
				this._log.appendLine(`Supervisor terminal closed with exit code ${terminal.exitStatus.code}; output:\n${contents}`);
			} else {
				this._log.appendLine(`Supervisor terminal closed unexpectedly; output:\n${contents}`);
			}

			// Display a notification that directs users to open the log to get more information
			const selection = await vscode.window.showInformationMessage(
				vscode.l10n.t('There was an error starting the kernel supervisor. Check the log for more information.'), {
				title: vscode.l10n.t('Open Log'),
				execute: () => {
					this._log.show(false);
				}
			});
			if (selection) {
				selection.execute();
			}
		});

		// Ensure this listener is disposed when the API is disposed
		this._disposables.push(closeListener);

		// Ensure the output file is cleaned up when the API is disposed
		this._disposables.push(new vscode.Disposable(() => {
			fs.unlinkSync(outFile);
		}));

		// Wait for the terminal to start and get the PID
		await terminal.processId;

		// If an HTTP proxy is set, exempt the supervisor from it; since this
		// is a local server, we generally don't want to route it through a
		// proxy
		if (process.env.http_proxy) {
			// Add the server's port to the no_proxy list, amending it if it
			// already exists
			process.env.no_proxy = (process.env.no_proxy ? process.env.no_proxy + ',' : '') + `localhost:${port}`;
			this._log.appendLine(`HTTP proxy set to ${process.env.http_proxy}; setting no_proxy to ${process.env.no_proxy} to exempt supervisor`);
		}

		// Establish the API
		this._api.basePath = `http://localhost:${port}`;
		this._api.setDefaultAuthentication(bearer);

		// List the sessions to verify that the server is up. The process is
		// alive for a few milliseconds before the HTTP server is ready, so we
		// may need to retry a few times.
		for (let retry = 0; retry < 40; retry++) {
			try {
				const status = await this._api.serverStatus();
				this._log.appendLine(`Kallichore ${status.body.version} server online with ${status.body.sessions} sessions`);
				break;
			} catch (err) {
				const elapsed = Date.now() - startTime;

				// Has the terminal exited? if it has, there's no point in continuing to retry.
				if (exited) {
					throw new Error(`The supervisor process exited before the server was ready.`);
				}

				// ECONNREFUSED is a normal condition during startup; the server
				// isn't ready yet. Keep trying until we hit the retry limit,
				// about 2 seconds from the time we got a process ID
				// established.
				if (err.code === 'ECONNREFUSED') {
					if (retry < 19) {
						// Log every few attempts. We don't want to overwhelm
						// the logs, and it's normal for us to encounter a few
						// connection refusals before the server is ready.
						if (retry % 5 === 0) {
							this._log.appendLine(`Waiting for Kallichore server to start (attempt ${retry + 1}, ${elapsed}ms)`);
						}
						// Wait a bit and try again
						await new Promise((resolve) => setTimeout(resolve, 50));
						continue;
					} else {
						// Give up; it shouldn't take this long to start
						let message = `Kallichore server did not start after ${Date.now() - startTime}ms`;
						this._log.appendLine(message);

						// The error that we're about to throw will show up in
						// the Console. If there's any content in the log
						// files, append it to the error message so that the
						// user can see it without clicking over to the logs.
						if (fs.existsSync(outFile)) {
							// Note that we don't need to append this content
							// to the lgos since the output file is already
							// being watched by the log streamer.
							const contents = fs.readFileSync(outFile, 'utf8');
							if (contents) {
								message += `; output:\n\n${contents}`;
							}
						}
						// Show the terminal so the user can see the output
						terminal.show();
						throw new Error(message);
					}
				}

				// If the request times out, go ahead and try again as long as
				// it hasn't been more than 10 seconds since we started. This
				// can happen if the server is slow to start.
				if (err.code === 'ETIMEDOUT' && elapsed < 10000) {
					this._log.appendLine(`Request for server status timed out; retrying (attempt ${retry + 1}, ${elapsed}ms)`);
					continue;
				}

				this._log.appendLine(`Failed to get initial server status from Kallichore; ` +
					`server may not be running or may not be ready. Check the terminal for errors. ` +
					`Error: ${JSON.stringify(err)}`);
				throw err;
			}
		}

		this._log.appendLine(`Kallichore server started in ${Date.now() - startTime}ms`);

		// Begin streaming the logs (cleaning up any existing streamer)
		if (this._logStreamer) {
			this._logStreamer.dispose();
		}
		this._logStreamer = new LogStreamer(this._log, logFile);
		this._logStreamer.watch().then(() => {
			this._log.appendLine(`Streaming Kallichore server logs from ${logFile} (log level: ${logLevel})`);
		});

		// Now that we're online, we can dispose of the close listener
		closeListener.dispose();

		// Open the started barrier and save the server state since we're online
		this._started.open();
		const state: KallichoreServerState = {
			base_path: this._api.basePath,
			port,
			server_path: shellPath,
			server_pid: await terminal.processId || 0,
			bearer_token: bearerToken,
			log_path: logFile
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
		if (pid) {
			try {
				process.kill(pid, 0);
			} catch (err) {
				this._log.appendLine(`Kallichore server PID ${pid} is not running`);
				return false;
			}
		}

		// Clear logs from previous connection; since we don't maintain our
		// position in the log file, we'll wind up with duplicate logs after
		// reconnecting.
		this._log.clear();
		this._log.appendLine(`Reconnecting to Kallichore server at ${serverState.base_path} (PID ${pid})`);

		// Re-establish the bearer token
		const bearer = new HttpBearerAuth();
		bearer.accessToken = serverState.bearer_token;
		this._api.setDefaultAuthentication(bearer);

		// Re-establish the log stream
		if (this._logStreamer) {
			this._logStreamer.dispose();
		}
		this._logStreamer = new LogStreamer(this._log, serverState.log_path);
		this._logStreamer.watch().then(() => {
			this._log.appendLine(`Streaming Kallichore server logs at ${serverState.log_path}`);
		});

		// Reconnect and get the session list
		this._api.basePath = serverState.base_path;
		const status = await this._api.serverStatus();
		this._started.open();
		this._log.appendLine(`Kallichore ${status.body.version} server reconnected with ${status.body.sessions} sessions`);

		// Mark this a restored server
		this._newSupervisor = false;

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

		// Ensure the server is started before trying to create the session
		await this.ensureStarted();

		// Create the session object
		const session = new KallichoreSession(
			sessionMetadata, runtimeMetadata, dynState, this._api, true, _extra);

		this._log.appendLine(`Creating session: ${JSON.stringify(sessionMetadata)}`);

		// Create the session on the server
		try {
			await session.create(kernel);
		} catch (err) {
			// If the connection was refused, check the server status; this
			// suggests that the server may have exited
			if (err.code === 'ECONNREFUSED') {
				this._log.appendLine(`Connection refused while attempting to create session; checking server status`);
				await this.testServerExited();
			}

			// Rethrow the error for the caller to handle
			throw err;
		}

		// Save the session now that it has been created on the server
		this.addDisconnectHandler(session);
		this._sessions.push(session);

		return session;
	}

	/**
	 * Adds a disconnect handler to a session that will check the server status
	 * when the session's websocket disconnects.
	 *
	 * @param session The session to add the disconnect handler to
	 */
	private addDisconnectHandler(session: KallichoreSession) {
		this._disposables.push(session.disconnected.event(async (state: positron.RuntimeState) => {
			if (state !== positron.RuntimeState.Exited) {
				// The websocket disconnected while the session was still
				// running. This could signal a problem with the supervisor; we
				// should see if it's still running.
				this._log.appendLine(`Session '${session.metadata.sessionName}' disconnected while in state '${state}'. This is unexpected; checking server status.`);

				// If the server did not exit, and the session also appears to
				// still be running, try to reconnect the websocket. It's
				// possible the connection just got dropped or interrupted.
				const exited = await this.testServerExited();
				if (!exited) {
					this._log.appendLine(`The server is still running; attempting to reconnect to session ${session.metadata.sessionId}`);
					try {
						await withTimeout(session.connect(), 2000, `Timed out reconnecting to session ${session.metadata.sessionId}`);
						this._log.appendLine(`Successfully restored connection to  ${session.metadata.sessionId}`);
					} catch (err) {
						// The session could not be reconnected; mark it as
						// offline and explain to the user what happened.
						session.markOffline('Lost connection to the session WebSocket event stream and could not restore it: ' + err);
						vscode.window.showErrorMessage(vscode.l10n.t('Unable to re-establish connection to {0}: {1}', session.metadata.sessionName, err));
					}
				}
			}
		}));
	}

	/**
	 * Tests the server after a session disconnects, or after an RPC fails with
	 * ECONNREFUSED, to see if it is still running.  If it isn't, marks all
	 * sessions as exited and restarts the server.
	 *
	 * Consider: This only tests the server's local process ID, not the server
	 * itself.  We can't use this technique on a remote server, and it doesn't
	 * handle the case where the server process is running but it's become
	 * unresponsive.
	 *
	 * @returns A promise that resolves when the server has been confirmed to
	 * be running or has been restarted. Resolves with `true` if the server did
	 * in fact exit, `false` otherwise.
	 */
	private async testServerExited(): Promise<boolean> {
		// If we're currently starting, it doesn't make sense to test the
		// server status since we're already in the process of starting it.
		if (this._starting) {
			await this._starting.promise;
			return false;
		}

		// Load the server state so we can check the process ID
		const serverState =
			this._context.workspaceState.get<KallichoreServerState>(KALLICHORE_STATE_KEY);

		// If there's no server state, return as we can't check its status
		if (!serverState) {
			this._log.appendLine(`No Kallichore server state found; cannot test server process`);
			return false;
		}

		// Test the process ID to see if the server is still running.
		// If we have no process ID, we can't check the server status, so we
		// presume it's running to be safe.
		let serverRunning = true;
		if (serverState.server_pid) {
			try {
				process.kill(serverState.server_pid, 0);
				this._log.appendLine(`Kallichore server PID ${serverState.server_pid} is still running`);
			} catch (err) {
				this._log.appendLine(`Kallichore server PID ${serverState.server_pid} is not running`);
				serverRunning = false;
			}
		}

		// The server is still running; nothing to do
		if (serverRunning) {
			return false;
		}

		// Clean up the state so we don't try to reconnect to a server that
		// isn't running.
		this._context.workspaceState.update(KALLICHORE_STATE_KEY, undefined);

		// We need to mark all sessions as exited since (at least right now)
		// they cannot live without the supervisor.
		for (const session of this._sessions) {
			session.markExited(1, positron.RuntimeExitReason.Error);
		}

		// Stop streaming the logs from the old server
		if (this._logStreamer) {
			this._logStreamer.dispose();
			this._logStreamer = undefined;
		}

		// Reset the start barrier and start the server again.
		this._started = new Barrier();
		try {
			// Start the server again
			await this.ensureStarted();

			vscode.window.showInformationMessage(
				vscode.l10n.t('The process supervising the interpreters has exited unexpectedly and was automatically restarted. You may need to start your interpreter again.'));

		} catch (err) {
			vscode.window.showInformationMessage(
				vscode.l10n.t('The process supervising the interpreters has exited unexpectedly and could not automatically restarted: ' + err));
		}

		// The server did exit.
		return true;
	}

	/**
	 * Validate an existing session for a Jupyter-compatible kernel.
	 */
	async validateSession(sessionId: string): Promise<boolean> {
		// Wait for the server to start if it's not already running
		await this.ensureStarted();

		// If we started a new server instance, no sessions will be running, so
		// save the round trip and just return false.
		if (this._newSupervisor) {
			return false;
		}
		try {
			// Get the session status from the server
			const session = await this._api.getSession(sessionId);

			// The session is valid if it's in one of the running states (i.e.
			// not 'never started' or 'exited').
			//
			// Consider: This creates an edge case for sessions that exit
			// naturally before the idle shutdown timeout has expired. Those
			// sessions will be considered invalid, so Positron will not
			// reconnect to them and there will be no way to see any output
			// they emitted between the time Positron was closed and the time
			// the session exited.
			const status = session.body.status;
			return status !== Status.Exited && status !== Status.Uninitialized;
		} catch (e) {
			// Swallow errors; we're just checking to see if the session is
			// alive.
			if (e instanceof HttpError && e.response.statusCode === 404) {
				// This is the expected error if the session is not found
				return false;
			}

			// Other errors are unexpected; log them and return false
			this._log.appendLine(`Error validating session ${sessionId}: ${summarizeError(e)}`);
		}

		return false;
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

		// Ensure the server is started before trying to restore the session
		await this.ensureStarted();

		return new Promise<JupyterLanguageRuntimeSession>((resolve, reject) => {
			this._api.getSession(sessionMetadata.sessionId).then(async (response) => {
				// Make sure the session is still running; it may have exited
				// while we were disconnected.
				const kcSession = response.body;
				if (kcSession.status === Status.Exited) {
					this._log.appendLine(`Attempt to reconnect to session ${sessionMetadata.sessionId} failed because it is no longer running`);
					reject(`Session ${sessionMetadata.sessionName} (${sessionMetadata.sessionId}) is no longer running`);
					return;
				}

				// Create the session object
				const session = new KallichoreSession(sessionMetadata, runtimeMetadata, {
					continuationPrompt: kcSession.continuationPrompt,
					inputPrompt: kcSession.inputPrompt,
				}, this._api, false);

				// Restore the session from the server
				try {
					session.restore(kcSession);
				} catch (err) {
					this._log.appendLine(`Failed to restore session ${sessionMetadata.sessionId}: ${JSON.stringify(err)}`);
					if (err.code === 'ECONNREFUSED') {
						this._log.appendLine(`Connection refused while attempting to restore session; checking server status`);
						await this.testServerExited();
					}
					reject(err);
				}
				// Save the session
				this.addDisconnectHandler(session);
				this._sessions.push(session);
				resolve(session);
			}).catch((err) => {
				if (err instanceof HttpError) {
					const message = summarizeHttpError(err);
					this._log.appendLine(`Failed to reconnect to session ${sessionMetadata.sessionId}: ${message}`);
					reject(message);
					return;
				}
				this._log.appendLine(`Failed to reconnect to session ${sessionMetadata.sessionId}: ${JSON.stringify(err)}`);
				reject(err);
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

		// Dispose of the log streamer
		if (this._logStreamer) {
			this._logStreamer.dispose();
			this._logStreamer = undefined;
		}

		// Dispose of any other disposables
		this._disposables.forEach(disposable => disposable.dispose());
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

		// Get the name of the server binary for the current platform
		const serverBin = os.platform() === 'win32' ? 'kcserver.exe' : 'kcserver';

		// Look for locally built Debug or Release server binaries. If both exist, we'll use
		// whichever is newest. This is the location where the kernel is typically built
		// by developers, who have `positron` and `kallichore` directories side-by-side.
		let devBinary: string | undefined;
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
			this._log.appendLine(`Loading Kallichore from disk in adjacent repository (${devBinary}). Make sure it's up-to-date.`);
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

	/**
	 * Reconnects to the active session, if one exists. Primarily useful as a
	 * troubleshooting tool.
	 */
	async reconnectActiveSession() {
		// Get the foreground session from the Positron API
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			vscode.window.showInformationMessage(vscode.l10n.t('No active session to reconnect to'));
			return;
		}

		// Find the session in our list
		const kallichoreSession = this._sessions.find(s => s.metadata.sessionId === session.metadata.sessionId);
		if (!kallichoreSession) {
			vscode.window.showInformationMessage(vscode.l10n.t('Active session {0} not managed by the kernel supervisor', session.metadata.sessionName));
			return;
		}

		// Ensure the session is still active
		if (kallichoreSession.runtimeState === positron.RuntimeState.Exited) {
			vscode.window.showInformationMessage(vscode.l10n.t('Session {0} is not running', session.metadata.sessionName));
			return;
		}

		// Disconnect the session; since the session is active, this should
		// trigger a reconnect.
		kallichoreSession.log('Disconnecting by user request', vscode.LogLevel.Info);
		kallichoreSession.disconnect();
	}

	/**
	 * Restarts the supervisor, ending all sessions.
	 */
	private async restartSupervisor(): Promise<void> {

		// If we never started the supervisor, just start it
		if (!this._started.isOpen()) {
			return this.ensureStarted();
		}

		this._log.appendLine('Restarting Kallichore server');

		// Clean up all the sessions and mark them as exited
		this._sessions.forEach(session => {
			session.markExited(0, positron.RuntimeExitReason.Shutdown);
			session.dispose();
		});
		this._sessions.length = 0;

		// Clear the workspace state so we don't try to reconnect to the old
		// server
		this._context.workspaceState.update(KALLICHORE_STATE_KEY, undefined);

		// Shut down the server itself
		try {
			await this._api.shutdownServer();
		} catch (err) {
			// We can start a new server even if we failed to shut down the old
			// one, so just log this error
			const message = summarizeError(err);
			this._log.appendLine(`Failed to shut down Kallichore server: ${message}`);
		}

		// If we know the terminal, kill it
		if (this._terminal) {
			this._terminal.dispose();
			this._terminal = undefined;
		}

		// Reset the start barrier
		this._started = new Barrier();

		// Start the new server
		try {
			await this.ensureStarted();
			vscode.window.showInformationMessage(vscode.l10n.t('Kernel supervisor successfully restarted'));
		} catch (err) {
			const message = err instanceof HttpError ? summarizeHttpError(err) : err;
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to restart kernel supervisor: {0}', err));
		}
	}
}
