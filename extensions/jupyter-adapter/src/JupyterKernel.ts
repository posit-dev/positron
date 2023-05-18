/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as zmq from 'zeromq/v5-compat';
import * as os from 'os';
import * as fs from 'fs';
import { JupyterSocket } from './JupyterSocket';
import { serializeJupyterMessage } from './JupyterMessageSerializer';
import { deserializeJupyterMessage } from './JupyterMessageDeserializer';
import { EventEmitter } from 'events';
import { JupyterMessageHeader } from './JupyterMessageHeader';
import { JupyterMessage } from './JupyterMessage';
import { JupyterMessageSpec } from './JupyterMessageSpec';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterCommOpen } from './JupyterCommOpen';
import { JupyterCommClose } from './JupyterCommClose';
import { v4 as uuidv4 } from 'uuid';
import { JupyterShutdownRequest } from './JupyterShutdownRequest';
import { JupyterInterruptRequest } from './JupyterInterruptRequest';
import { JupyterKernelSpec } from './JupyterKernelSpec';
import { JupyterConnectionSpec } from './JupyterConnectionSpec';
import { JupyterSockets } from './JupyterSockets';
import { JupyterExecuteRequest } from './JupyterExecuteRequest';
import { JupyterInputReply } from './JupyterInputReply';
import { Tail } from 'tail';
import { JupyterCommMsg } from './JupyterCommMsg';
import { createJupyterSession, JupyterSession, JupyterSessionState } from './JupyterSession';
import path = require('path');
import { StartupFailure } from './StartupFailure';
import { JupyterKernelStatus } from './JupyterKernelStatus';

/** The message sent to the Heartbeat socket on a regular interval to test connectivity */
const HEARTBEAT_MESSAGE = 'heartbeat';

/** The message sent to the Heartbeat socket when the kernel is offline */
const RECONNECT_MESSAGE = 'reconnect';

export class JupyterKernel extends EventEmitter implements vscode.Disposable {
	private readonly _spec: JupyterKernelSpec;
	private _process: ChildProcess | null;

	/** An object that watches (tails) the kernel's log file */
	private _logTail?: Tail;

	/** The kernel's current state */
	private _status: positron.RuntimeState;

	// ZeroMQ sockets ---
	private _control: JupyterSocket | null;
	private _shell: JupyterSocket | null;
	private _stdin: JupyterSocket | null;
	private _iopub: JupyterSocket | null;
	private _heartbeat: JupyterSocket | null;

	/**
	 * A map of IDs to pending input requests; used to match up input replies
	 * with the correct request
	 */
	private _inputRequests: Map<string, JupyterMessageHeader> = new Map();

	/**
	 * A timer that listens to heartbeats, is reset on every hearbeat, and
	 * expires when the kernel goes offline; used to detect when the kernel has
	 * become unresponsive.
	 */
	private _heartbeatTimer: NodeJS.Timeout | null;

	/**
	 * A timer used to schedule the next heartbeat sent to the kernel
	 */
	private _nextHeartbeat: NodeJS.Timeout | null;

	/** The timestamp at which we last received a heartbeat message from the kernel */
	private _lastHeartbeat: number;

	/** The state of the kernel when it went offline. */
	private _offlineState: positron.RuntimeState;

	/** An object that tracks the Jupyter session information, such as session ID and ZeroMQ ports */
	private _session?: JupyterSession;

	/**
	 * The terminal in which the kernel process is running. Note that we only have a terminal handle
	 * when the kernel started in this session; if we reconnect to a running kernel, this will be
	 * undefined.
	 */
	private _terminal?: vscode.Terminal;

	/** The channel to which output for this specific terminal is logged, if any */
	private _logChannel?: vscode.OutputChannel;

	/** The exit code, if any */
	private _exitCode: number;

	constructor(private readonly _context: vscode.ExtensionContext,
		spec: JupyterKernelSpec,
		private readonly _runtimeId: string,
		private readonly _channel: vscode.OutputChannel) {
		super();
		this._spec = spec;
		this._process = null;

		this._control = null;
		this._shell = null;
		this._stdin = null;
		this._iopub = null;
		this._heartbeat = null;
		this._heartbeatTimer = null;
		this._nextHeartbeat = null;
		this._lastHeartbeat = 0;
		this._exitCode = 0;

		// Set the initial status to uninitialized (we'll change it later if we
		// discover it's actually running)
		this._status = positron.RuntimeState.Uninitialized;
		this._offlineState = positron.RuntimeState.Uninitialized;

		// Listen to our own status change events
		this.on('status', (status: positron.RuntimeState) => {
			this.onStatusChange(status);
		});

		// Look for metadata about a running kernel in the current workspace by
		// checking the value stored for this runtime ID (we support running
		// exactly one kernel per runtime ID). If we find it, it's a
		// JupyterSessionState object, which contains the connection
		// information.
		const state = this._context.workspaceState.get(this._runtimeId);
		if (state) {
			// We found session state for this kernel. Connect to it.
			const sessionState = state as JupyterSessionState;

			// Set the status to initializing so that we don't try to start a
			// new kernel before we've tried to connect to the existing one.
			this.setStatus(positron.RuntimeState.Initializing);

			// Attempt to reconnect. If successful we'll set the new state during the reconnect
			// process. If not, move the status back to Uninitialized.
			this.reconnect(sessionState).catch((err) => {
				this.log(`Failed to reconnect to running kernel: ${err}`);

				// Return to the Uninitialized state so that a fresh instance can be started
				this.setStatus(positron.RuntimeState.Uninitialized);

				// Since we could not connect to the preserved state, remove it.
				this.log(`Removing stale session state for process ${sessionState.processId}`);
				this._context.workspaceState.update(this._runtimeId, undefined);
			});
		}

		// Listen for terminals to close; if our own terminal closes, then we need
		// to update our status
		vscode.window.onDidCloseTerminal((closedTerminal) => {
			if (closedTerminal === this._terminal) {
				if (this._status === positron.RuntimeState.Starting) {
					// If we were starting the kernel, then we failed to start
					this.log(
						`${this._spec.display_name} failed to start; exit code: ${closedTerminal.exitStatus?.code}`);
				} else {
					// Otherwise, we exited normally (but print the exit code anyway)
					this.log(
						`${this._spec.display_name} exited with code ${closedTerminal.exitStatus?.code}`);
				}

				// Save the exit code for error reporting if we know it
				if (closedTerminal.exitStatus && closedTerminal.exitStatus.code) {
					this._exitCode = closedTerminal.exitStatus.code;
				}

				// The kernel's status is now exited
				this.setStatus(positron.RuntimeState.Exited);
			}
		});
	}

	/**
	 * Attempts to discover and reconnect to a running kernel. Returns a promise
	 * that resolves when the kernel is connected, or rejects if the kernel is
	 * not running.
	 *
	 * @param sessionState The saved session state for the kernel
	 */
	private async reconnect(sessionState: JupyterSessionState) {
		// Save the process ID
		const pid = sessionState.processId;

		// Check to see whether the process is still running
		if (this.isRunning(pid)) {

			// It's running! Try to connect.
			this.log(`Detected running ${this._spec.language} kernel with PID ${pid}, attempting to reconnect...`);

			// Create the new session wrapper; this will throw if the session state is invalid
			// or can't be loaded from disk.
			const session = new JupyterSession(sessionState);

			// Defer the connection until the next tick, so that the
			// caller has a chance to register for the 'status' event we emit
			// below.
			return new Promise<void>((resolve, reject) => {
				setTimeout(() => {
					// We are now "starting" the kernel. (Consider: should we
					// have a "connecting" state?)
					this.setStatus(positron.RuntimeState.Starting);

					// Connect to the running kernel in the terminal
					this.connectToSession(session).then(
						() => {
							this.log(`Connected to ${this._spec.language} kernel with PID ${pid}.`);

							// We're connected! Resolve the promise.
							resolve();
						}
					).catch((err) => {
						// If we failed to connect, then we need to remove the stale session state
						this.log(`Failed to connect to kernel with PID ${pid}.`);

						// Reject the promise
						reject(err);
					});
				});
			});
		} else {
			// The kernel process is no longer running, so we need to remove the stale session state
			throw new Error(`Kernel process ${pid} no longer running`);
		}
	}

	/**
	 * Connects to a Jupyter kernel, given the path to the connection JSON file.
	 * Returns a promise that resolves when all the ZeroMQ sockets are connected.
	 *
	 * Note that this is used both in the kernel's initial startup and when
	 * reconnecting.
	 *
	 * @param connectionJsonPath The path to the connection JSON file
	 */
	private async connect(connectionJsonPath: string) {
		// Create ZeroMQ sockets
		const logger = (message: string) => this.log(message);
		this._control = new JupyterSocket('Control', zmq.socket('dealer'), logger);
		this._shell = new JupyterSocket('Shell', zmq.socket('dealer'), logger);
		this._stdin = new JupyterSocket('Stdin', zmq.socket('dealer'), logger);
		this._iopub = new JupyterSocket('I/O', zmq.socket('sub'), logger);
		this._heartbeat = new JupyterSocket('Heartbeat', zmq.socket('req'), logger);

		// Create the socket identity for the shell and stdin sockets
		const shellId = Buffer.from('positron-shell', 'utf8');
		this._shell.setZmqIdentity(shellId);
		this._stdin.setZmqIdentity(shellId);

		// Read a JupyterConnectionSpec from the connection file
		const connectionSpec: JupyterConnectionSpec =
			JSON.parse(fs.readFileSync(connectionJsonPath, 'utf8'));

		// Use the control channel to detect if the kernel unexpectedly disconnects
		this._control.socket().on('disconnect', () => {
			if (this._status !== positron.RuntimeState.Exiting &&
				this._status !== positron.RuntimeState.Exited) {
				this.log(`Kernel '${this._spec.display_name}' unexpectedly disconnected while in status '${this._status}', will exit`);
				this.setStatus(positron.RuntimeState.Exited);
			}
		});

		// Bind the sockets to the ports specified in the connection file;
		// returns a promise that resovles when all the sockets are connected
		return new Promise<void>((resolve, reject) => {
			Promise.all([
				this._control!.connect(connectionSpec.control_port),
				this._shell!.connect(connectionSpec.shell_port),
				this._stdin!.connect(connectionSpec.stdin_port),
				this._iopub!.connect(connectionSpec.iopub_port),
				this._heartbeat!.connect(connectionSpec.hb_port),
			]).then(() => {
				// Connected!
				resolve();
			}).catch((err) => {
				// Wrap any errors in a StartupFailure so that any logs are
				// included in the message delivered to the client
				reject(this.createStartupFailure(err));
			});
		});
	}

	/**
	 * Connects to running kernel process, asynchronously. The returned promise
	 * resolves when the kernel is ready to receive messages.
	 *
	 * @param session The Jupyter session information for the kernel running in
	 *   the terminal
	 */
	private async connectToSession(session: JupyterSession) {

		// Return a promise that resolves when we receive the initial heartbeat
		return new Promise<void>((resolve, reject) => {

			// Establish a log channel for the kernel we're connecting to
			this._logChannel = vscode.window.createOutputChannel(`Runtime: ${this._spec.display_name}`);

			// Bind to the Jupyter session
			this._session = session;

			this.log(
				`Connecting to ${this._spec.display_name} kernel (pid ${session.state.processId})`);

			// The kernel is currently starting. If it skips right to the "exited" status, then
			// we'll throw an error so that this async function rejects.
			this.once('status', (status) => {
				if (status === positron.RuntimeState.Exited) {
					reject(this.createStartupFailure(
						`Kernel exited with status ${this._exitCode} during startup.`));
				}
			});

			// Begin streaming the log file, if it exists. We create the log file
			// when we start the kernel, if it has an argument that specifies a log
			// file.
			const logFilePath = this._session!.state.logFile;
			if (fs.existsSync(logFilePath)) {
				this.streamLogFileToChannel(logFilePath, this._spec.language, this._logChannel);
			}

			// Connect to the kernel's sockets; wait for all sockets to connect before continuing
			this.connect(session.state.connectionFile).then(() => {

				// Subscribe to all topics and connect the IOPub socket
				this._iopub?.socket().subscribe('');
				this._iopub?.socket().on('message', (...args: any[]) => {
					const msg = deserializeJupyterMessage(args, this._session!.key, this._channel);

					// If this is a status message, save the status. Note that
					// we do not emit an event here (via `setStatus`) since
					// idle/busy status events are emitted one layer up in the
					// `LanguageRuntimeAdapter`.
					if (msg?.header.msg_type === 'status') {
						const statusMsg = msg.content as JupyterKernelStatus;
						const state = statusMsg.execution_state as positron.RuntimeState;
						if (state === 'idle') {
							this._status = positron.RuntimeState.Idle;
						} else if (state === 'busy') {
							this._status = positron.RuntimeState.Busy;
						}
					}

					if (msg !== null) {
						this.emitMessage(JupyterSockets.iopub, msg);
					}
				});

				// Connect the Shell socket
				this._shell?.socket().on('message', (...args: any[]) => {
					const msg = deserializeJupyterMessage(args, this._session!.key, this._channel);
					if (msg !== null) {
						this.emitMessage(JupyterSockets.shell, msg);
					}
				});

				// Connect the Stdin socket
				this._stdin?.socket().on('message', (...args: any[]) => {
					const msg = deserializeJupyterMessage(args, this._session!.key, this._channel);
					if (msg !== null) {
						// If this is an input request, save the header so we can
						// can line it up with the client's response.
						if (msg.header.msg_type === 'input_request') {
							this._inputRequests.set(msg.header.msg_id, msg.header);
						}
						this.emitMessage(JupyterSockets.stdin, msg);
					}
				});

				// Set a timer to reject the promise if we don't receive the initial
				// heartbeat within 10 seconds
				const timeout = setTimeout(() => {
					reject(this.createStartupFailure(
						'Timed out waiting 10 seconds for initial heartbeat'));
				}, 10000);

				// Wait for the initial heartbeat
				this._heartbeat?.socket().once('message', (msg: string) => {

					// We got the heartbeat, so cancel the timeout
					clearTimeout(timeout);

					// Resolve the promise, mark the kernel as ready, and start the heartbeat
					// check
					this.log('Receieved initial heartbeat: ' + msg);
					this.setStatus(positron.RuntimeState.Ready);
					resolve();

					const seconds = vscode.workspace.getConfiguration('positron').get('heartbeat', 30) as number;
					this.log(`Starting heartbeat check at ${seconds} second intervals...`);
					this.heartbeat();
					this._heartbeat?.socket().on('message', (msg: string) => {
						this.onHeartbeat(msg);
					});
				});
				this._heartbeat?.socket().send([HEARTBEAT_MESSAGE]);

			}).catch((err) => {
				reject(err);
			});
		});
	}

	/**
	 * Starts the Jupyter kernel. Resolves when the kernel is ready to receive
	 * messages; rejects with a StartupFailure error if the kernel fails to
	 * start.
	 */
	public async start() {

		// If a request to start the kernel arrives while we are initializing,
		// we can't handle it right away. Defer the request to start the kernel
		// until initialization either completes or fails.
		if (this._status === positron.RuntimeState.Initializing) {
			this.log(`Attempt to start ${this._spec.display_name} kernel while initializing; deferring.`);

			// Wait for the next status change to see what action we should take next.
			return new Promise<void>((resolve, reject) => {
				const callback = (status: positron.RuntimeState) => {
					if (status === positron.RuntimeState.Initializing) {
						// Ignore status changes to initializing; we're waiting for
						// the kernel to move on to another state.
						return;
					}

					// Unsubscribe from status changes now that we're done waiting
					this.off('status', callback);

					if (status === positron.RuntimeState.Uninitialized) {
						// The kernel was initializing but returned to the
						// uninitialized state; this generally means we couldn't
						// connect to an existing kernel, and it's safe to start a
						// new one.
						this.log(`Performing deferred start for ${this._spec.display_name} kernel`);

						// Defer the start until the next tick so we don't recurse
						setTimeout(() => {
							this.start().then(() => {
								resolve();
							}).catch((err) => {
								reject(err);
							});
						}, 0);
					} else {
						// The kernel was initializing but has moved on to another
						// state; resolve the promise and treat it as already
						// started.
						this.log(`Skipping deferred start for ${this._spec.display_name} kernel; already '${status}'`);
						resolve();
					}
				};

				this.on('status', callback);
			});
		}

		// We can only start the kernel if it's uninitialized (never started) or
		// fully exited; trying to start from any other state is an error.
		if (this._status !== positron.RuntimeState.Uninitialized &&
			this._status !== positron.RuntimeState.Exited) {
			this.log(`Attempt to start ${this._spec.display_name} kernel but it's already '${this._status}'; ignoring.`);
			return;
		}

		// Mark the kernel as initializing so we don't try to start it again
		// during bootup
		this.setStatus(positron.RuntimeState.Initializing);

		// Create a new session; this allocates a connection file and log file
		// and establishes available ports and sockets for the kernel to connect
		// to.
		const session = await createJupyterSession();
		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;

		// Form the command-line arguments to the kernel process
		const args = this._spec.argv.map((arg, _idx) => {
			// Replace {connection_file} with the connection file path
			if (arg === '{connection_file}') {
				return connnectionFile;
			}

			// Replace {log_file} with the log file path. Not all kernels
			// have this argument.
			if (arg === '{log_file}') {
				// Ensure the log file exists, so we can start streaming it before the
				// kernel starts writing to it.
				fs.writeFileSync(logFile, '');
				return logFile;
			}

			return arg;
		}) as Array<string>;

		const command = args.join(' ');

		// Create environment.
		const env = { POSITRON_VERSION: positron.version };
		Object.assign(env, process.env, this._spec.env);

		// We are now starting the kernel
		this.setStatus(positron.RuntimeState.Starting);

		this.log('Starting ' + this._spec.display_name + ' kernel: ' + command + '...');
		if (this._spec.env) {
			this.log('Environment: ' + JSON.stringify(this._spec.env));
		}

		// Look up the configuration to see if we should show terminal we're
		// about to start. It can be useful to see the terminal as a debugging
		// aid, but end users shouldn't see it in most cases.
		const showTerminal = vscode.workspace.getConfiguration('positron.jupyterAdapter')
			.get('showTerminal', false);

		const kernelWrapperPath = path.join(this._context.extensionPath,
			'resources',
			process.platform === 'win32' ?
				'kernel-wrapper.bat' :
				'kernel-wrapper.sh');
		const logArg = [logFile];

		// Use the VS Code terminal API to create a terminal for the kernel
		vscode.window.createTerminal(<vscode.TerminalOptions>{
			name: this._spec.display_name,
			shellPath: kernelWrapperPath,
			shellArgs: logArg.concat(args),
			env,
			message: '',
			hideFromUser: !showTerminal,
			isTransient: false
		});

		// Wait for the terminal to open
		return new Promise<void>((resolve, reject) => {
			const disposable = vscode.window.onDidOpenTerminal((openedTerminal) => {
				if (openedTerminal.name === this._spec.display_name) {
					// Read the process ID and connect to the kernel when it's ready
					openedTerminal.processId.then((pid) => {
						if (pid) {
							// Save the process ID in the session state
							session.state.processId = pid;

							// Write the session state to workspace storage
							this.log(
								`Writing session state to workspace storage: '${this._runtimeId}' => ${JSON.stringify(session.state)}`);
							this._context.workspaceState.update(this._runtimeId, session.state);

							// Clean up event listener now that we've located the
							// correct terminal
							disposable.dispose();

							// Save a reference to the terminal so we can close it later if needed
							this._terminal = openedTerminal;

							// Connect to the kernel running in the terminal
							this.connectToSession(session).then(() => {
								resolve();
							}).catch((err) => {
								reject(err);
							});
						}
						// Ignore terminals that don't have a process ID
					});
				}
			});
		});
	}

	/**
	 * Opens a new communications channel (comm) with the kernel.
	 *
	 * @param targetName The name of the target comm to create.
	 * @param id The ID of the comm to create.
	 * @param data Data to send to the comm.
	 */
	public openComm(targetName: string, id: string, data: object): Promise<void> {
		// Create the message to send to the kernel
		const msg: JupyterCommOpen = {
			target_name: targetName,  // eslint-disable-line
			comm_id: id,  // eslint-disable-line
			data: data
		};

		// Dispatch it
		return this.send(uuidv4(), 'comm_open', this._shell!, msg);
	}

	/**
	 * Closes a communications channel (comm) with the kernel.
	 */
	public closeComm(id: string) {
		// Create the message to send to the kernel
		const msg: JupyterCommClose = {
			comm_id: id,  // eslint-disable-line
			data: {}
		};

		// Dispatch it
		this.send(uuidv4(), 'comm_close', this._shell!, msg);
	}

	/**
	 * Sends a message to a communications channel (comm) with the kernel.
	 */
	public sendCommMessage(id: string, message_id: string, data: object) {
		// Create the message to send to the kernel
		const msg: JupyterCommMsg = {
			comm_id: id,  // eslint-disable-line
			data: data
		};

		// Dispatch it
		this.send(message_id, 'comm_msg', this._shell!, msg);
	}

	/**
	 * Get the kernel's display name
	 *
	 * @returns The kernel's display name
	 */
	public displayName(): string {
		return this._spec.display_name;
	}

	/**
	 * Gets the kernel's metadata (specification)
	 *
	 * @returns The kernel's metadata
	 */
	public spec(): JupyterKernelSpec {
		return this._spec;
	}

	/**
	 * Get the kernel's current status
	 *
	 * @returns The kernel's current status
	 */
	public status(): positron.RuntimeState {
		return this._status;
	}

	/**
	 * Restarts the kernel
	 */
	public async restart() {

		// Update status
		this.setStatus(positron.RuntimeState.Exiting);

		// Request that the kernel shut down
		this.shutdown(true);

		// Start the kernel again once the process finishes shutting down
		this._process?.once('exit', () => {
			this.log(`Waiting for '${this._spec.display_name}' to restart...`);
			this.start();
		});
	}

	/**
	 * Tells the kernel to shut down
	 */
	public shutdown(restart: boolean) {
		this.setStatus(positron.RuntimeState.Exiting);
		const msg: JupyterShutdownRequest = {
			restart: restart
		};
		this.send(uuidv4(), 'shutdown_request', this._control!, msg);
	}

	/**
	 * Interrupts the kernel
	 */
	public interrupt() {
		this.setStatus(positron.RuntimeState.Interrupting);
		const msg: JupyterInterruptRequest = {};
		this.send(uuidv4(), 'interrupt_request', this._control!, msg);
	}

	/**
	 * Emits a message packet to the webview
	 *
	 * @param socket The socket on which the message was emitted
	 * @param msg The message itself
	 */
	private emitMessage(socket: JupyterSockets, msg: JupyterMessage) {
		// If the kernel is marked offline, and it emits a message, then it has come back online.
		// Emit a status change event to reflect this.
		if (this._status === positron.RuntimeState.Offline) {
			this.log(`Kernel emitted '${msg.header.msg_type}' and is now back online.`);
			// Restore the kernel's status to what it was before it went offline
			if (msg.header.msg_type !== 'status') {
				this.setStatus(this._offlineState);
			}
		}

		const packet: JupyterMessagePacket = {
			type: 'jupyter-message',
			message: msg.content,
			msgId: msg.header.msg_id,
			msgType: msg.header.msg_type,
			when: msg.header.date,
			originId: msg.parent_header ? msg.parent_header.msg_id : '',
			socket: socket
		};
		this.log(`RECV ${msg.header.msg_type} from ${socket}: ${JSON.stringify(msg)}`);
		this.emit('message', packet);
	}

	/**
	 * Executes a fragment of code in the kernel.
	 *
	 * @param code The code to execute.
	 * @param id A client-provided ID for the execution.
	 * @param mode The execution mode.
	 * @param errorBehavior The error behavior.
	 */
	public execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		// Create the message to send to the kernel
		const msg: JupyterExecuteRequest = {
			// Pass code to be executed
			code: code,

			// Only allow stdin if we are executing interactively
			allow_stdin: mode !== positron.RuntimeCodeExecutionMode.Silent,

			// Execute silently if requested
			silent: mode === positron.RuntimeCodeExecutionMode.Silent,

			// Don't store history unless we are executing interactively
			store_history: mode === positron.RuntimeCodeExecutionMode.Interactive,

			// Not currently supported
			user_expressions: new Map(),

			// Whether to stop execution on error
			stop_on_error: errorBehavior === positron.RuntimeErrorBehavior.Stop
		};

		// Send the execution request to the kernel
		this.send(id, 'execute_request', this._shell!, msg)
			.catch((err) => {
				// Fail if we couldn't connect to the socket
				this.log(`Failed to send execute_request for ${code} (id ${id}): ${err}`);
			});
	}

	/**
	 * Reply to an input prompt issued by the kernel.
	 *
	 * @param id The ID of the input request
	 * @param value The value to send to the kernel
	 */
	public replyToPrompt(id: string, value: string) {
		// Create the message body
		const msg: JupyterInputReply = {
			value: value
		};

		// Attempt to find the prompt request that we are replying to
		const parent = this._inputRequests.get(id);
		if (parent) {
			// Found it! Send the reply
			this.log(`Sending input reply for ${id}: ${value}`);
			this.sendToSocket(uuidv4(), 'input_reply', this._stdin!, parent, msg);

			// Remove the request from the map now that we've replied
			this._inputRequests.delete(id);
		} else {
			// Couldn't find the request? Send the response anyway; most likely
			// the kernel doesn't care (it is probably waiting for this specific
			// response)
			this.log(`WARN: Failed to find parent for input request ${id}; sending anyway: ${value}`);
			this.send(uuidv4(), 'input_reply', this._stdin!, msg);
		}
	}

	/**
	 * Send a message to the kernel
	 *
	 * @param packet The message package
	 */
	public sendMessage(packet: JupyterMessagePacket) {
		let socket: JupyterSocket | null = null;

		switch (packet.socket) {
			case JupyterSockets.control:
				socket = this._control;
				break;
			case JupyterSockets.heartbeat:
				socket = this._heartbeat;
				break;
			case JupyterSockets.iopub:
				socket = this._iopub;
				break;
			case JupyterSockets.shell:
				socket = this._shell;
				break;
			case JupyterSockets.stdin:
				socket = this._stdin;
				break;
		}

		if (socket === null) {
			this.log(`No socket ${packet.socket} found.`);
			return;
		}

		this.send(packet.msgId, packet.msgType, socket, packet.message);
	}

	/**
	 * Dispose the kernel connection. Note that this does not dispose the
	 * session or the kernel itself; it remains running in a terminal.
	 */
	public dispose() {

		// Clean up file watcher for log file
		if (this._logTail) {
			this._logTail.unwatch();
		}

		// Dispose heartbeat timers
		this.disposeHeartbeatTimers();

		// Close sockets
		this.disposeAllSockets();
	}

	/**
	 * Dispose all sockets
	 */
	private disposeAllSockets() {
		this._control?.dispose();
		this._shell?.dispose();
		this._stdin?.dispose();
		this._heartbeat?.dispose();
		this._iopub?.dispose();

		this._control = null;
		this._shell = null;
		this._stdin = null;
		this._heartbeat = null;
		this._iopub = null;
	}

	/**
	 * Disposes the heartbeat timers -- both the timer that tracks the interval between beats and
	 * the timer that engages when the kernel goes offline.
	 */
	private disposeHeartbeatTimers() {
		if (this._heartbeatTimer) {
			clearTimeout(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}
		if (this._nextHeartbeat) {
			clearTimeout(this._nextHeartbeat);
			this._nextHeartbeat = null;
		}
	}

	private generateMessageHeader(id: string, type: string): JupyterMessageHeader {
		return {
			msg_id: id,            // eslint-disable-line
			msg_type: type,        // eslint-disable-line
			version: '5.0',
			date: (new Date()).toISOString(),
			session: this._session!.sessionId,
			username: os.userInfo().username
		};
	}

	/**
	 * Sends a message to the kernel. Convenience method for messages with no parent
	 * message.
	 *
	 * @param id The unique ID of the message
	 * @param type The type of the message
	 * @param dest The socket to which the message should be sent
	 * @param message The body of the message
	 */
	private send(id: string, type: string, dest: JupyterSocket, message: JupyterMessageSpec): Promise<void> {
		return this.sendToSocket(id, type, dest, {} as JupyterMessageHeader, message);
	}

	/**
	 * Sends a message to the kernel.
	 *
	 * @param id The unique ID of the message
	 * @param type The type of the message
	 * @param dest The socket to which the message should be sent
	 * @param parent The parent message header (if any, {} if no parent)
	 * @param message The body of the message
	 */
	private sendToSocket(id: string, type: string, dest: JupyterSocket, parent: JupyterMessageHeader, message: JupyterMessageSpec): Promise<void> {
		const msg: JupyterMessage = {
			buffers: [],
			content: message,
			header: this.generateMessageHeader(id, type),
			metadata: new Map(),
			parent_header: parent
		};
		this.log(`SEND ${msg.header.msg_type} to ${dest.title()}: ${JSON.stringify(msg)}`);
		return new Promise<void>((resolve, reject) => {
			dest.socket().send(serializeJupyterMessage(msg, this._session!.key), 0, (err) => {
				if (err) {
					this.log(`SEND ${msg.header.msg_type}: ERR: ${err}`);
					reject(err);
				} else {
					this.log(`SEND ${msg.header.msg_type}: OK`);
					resolve();
				}
			});
		});
	}

	/**
	 * Emits a heartbeat message and waits for the kernel to respond.
	 */
	private heartbeat() {
		const seconds = vscode.workspace.getConfiguration('positron.jupyterAdapter').get('heartbeat', 30) as number;
		this._lastHeartbeat = new Date().getUTCMilliseconds();
		this.log(`SEND heartbeat with timeout of ${seconds} seconds`);
		this._heartbeat?.socket().send([HEARTBEAT_MESSAGE]);
		this._heartbeatTimer = setTimeout(() => {
			this.enterOfflineState();
		}, seconds * 1000);
	}

	/**
	 * Enters the offline state for the kernel; called when the kernel fails to respond to a
	 * heartbeat message after a configurable amount of time.
	 */
	private enterOfflineState() {
		// Reentrancy guards
		if (this._status === positron.RuntimeState.Offline) {
			// Already offline; nothing to do
			return;
		}

		// Save the current state of the kernel as the offline state. We will presume the kernel
		// to still be in this state when the kernel comes back online.
		this._offlineState = this._status;

		// If the kernel hasn't responded in the given amount of time,
		// mark it as offline
		this.log(`Heartbeat timeout; marking kernel offline`);
		this.setStatus(positron.RuntimeState.Offline);

		// Ensure that the heartbeat timer is cleared before we start a new one
		this.disposeHeartbeatTimers();

		// We give the kernel a lot of grace (a 30 second configurable timeout)
		// for responding to heartbeats when online. Once it goes offline, though,
		// we become more aggressive about checking for it to come back online.
		//
		// Begin sending heartbeats every second until the kernel comes back.
		const onlinePoller = () => {
			// It'd be slightly more elegant to use `setInterval` here, but this
			// keeps the logic for handling the timer in `onHeartbeat` much
			// simpler.
			this._heartbeat?.socket().send([RECONNECT_MESSAGE]);
			this._heartbeatTimer = setTimeout(onlinePoller, 1000);
		};
		this._heartbeatTimer = setTimeout(onlinePoller, 1000);
	}

	/**
	 * Processes a heartbeat message from the kernel.
	 *
	 * @param msg The heartbeat received from the kernel
	 */
	private onHeartbeat(msg: string) {
		// Clear the timers that are waiting for a heartbeat
		this.disposeHeartbeatTimers();

		// If we know how long the kernel took, log it. We only record this time for regular
		// heartbeats, not reconnects.
		if (this._lastHeartbeat && msg === HEARTBEAT_MESSAGE) {
			const now = new Date().getUTCMilliseconds();
			const diff = now - this._lastHeartbeat;
			this._lastHeartbeat = 0;
			this.log(`Heartbeat received in ${diff}ms: ${msg}`);
		}

		// If the kernel was offline, it's now back online. Restore the kernel's previous state.
		if (this._status === positron.RuntimeState.Offline) {
			this.log(`Kernel is back online.`);
			this.setStatus(this._offlineState);
		}

		// Schedule the next heartbeat at the configured interval. Re-read the configuration
		// in case it changed.
		const seconds = vscode.workspace.getConfiguration('positron').get('heartbeat', 30) as number;
		if (seconds > 0) {
			this._nextHeartbeat = setTimeout(() => {
				this.heartbeat();
			}, seconds * 1000);
		}
	}

	/**
	 * Changes the kernel's status
	 *
	 * @param status The new status of the kernel
	 */
	private setStatus(status: positron.RuntimeState) {
		this.emit('status', status);
		this._status = status;
	}

	/**
	 * Processes a kernel status change
	 *
	 * @param status The new status of the kernel
	 */
	private async onStatusChange(status: positron.RuntimeState) {
		if (status === positron.RuntimeState.Exited) {
			// Ensure we don't try to reconnect to this kernel
			this._context.workspaceState.update(this._runtimeId, undefined);

			// Clean up the session files (logs, connection files, etc.)
			if (this._session) {
				this._session.dispose();
			}

			// If the terminal's still open, close it.
			if (this._terminal && this._terminal.exitStatus === undefined) {
				this._terminal.dispose();
			}

			// Dispose the remainder of the connection state
			this.dispose();
		}
	}

	/**
	 * Streams a log file to the output channel
	 */
	private streamLogFileToChannel(logFilePath: string, prefix: string, output: vscode.OutputChannel) {
		this.log('Streaming log file: ' + logFilePath);
		try {
			this._logTail = new Tail(logFilePath, { fromBeginning: true, useWatchFile: true });
		} catch (err) {
			this.log(`Error streaming log file ${logFilePath}: ${err}`);
			return;
		}

		// Establish a listener for new lines in the log file
		this._logTail.on('line', function (data: string) {
			output.appendLine(`[${prefix}] ${data}`);
		});
		this._logTail.on('error', function (error: string) {
			output.appendLine(`[${prefix}] ${error}`);
		});

		// Start watching the log file. This streams output until the kernel is
		// disposed.
		this._logTail.watch();
	}

	/**
	 * Checks whether a kernel process is still running using the operating
	 * system's process list.
	 *
	 * @param kernelPid The PID of the kernel process
	 */
	private isRunning(kernelPid: number): boolean {
		try {
			// Send a signal to the kernel process to see if it's still running.
			// This will throw an exception if the process is no longer running.
			process.kill(kernelPid, 0);
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Emits a message to the the log channel
	 *
	 * @param msg The message to log
	 */
	public log(msg: string) {
		// Ensure message isn't over the maximum length
		if (msg.length > 2048) {
			msg = msg.substring(0, 2048) + '... (truncated)';
		}

		if (this._logChannel) {
			// If we have a kernel-specific log channel, log to that. The kernel
			// log channel primarily streams the kernel's log, so prefix our
			// output with "Positron" to distinguish it from the output from the
			// language runtime.
			this._logChannel.appendLine(`[Positron] ${msg}`);
		} else {
			// Otherwise, log to the main Jupyter Adapter channel. This is
			// useful to send logs before the kernel is fully initialized; we
			// don't create a log channel for the kernel unless it actually
			// starts up.
			this._channel.appendLine(msg);
		}
	}

	/**
	 * Creates a detailed error object to emit to the client when the kernel fails
	 * to start.
	 *
	 * @param message The error message
	 * @returns A StartupFailure object containing the error message and the
	 *   contents of the kernel's log file, if it exists
	 */
	private createStartupFailure(message: string): StartupFailure {
		// Read the content of the log file, if it exists; this may contain more detail
		// about why the kernel exited.
		let logFileContent = '';
		if (this._session) {
			const state = this._session.state;
			if (fs.existsSync(state.logFile)) {
				logFileContent = fs.readFileSync(state.logFile, 'utf8');
			}
		}

		// Create a startup failure message
		return new StartupFailure(message, logFileContent);
	}
}
