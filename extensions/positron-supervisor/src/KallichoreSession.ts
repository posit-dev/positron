/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CommBackendMessage, JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession, JupyterSession, Comm } from './positron-supervisor';
import { ActiveSession, ConnectionInfo, DefaultApi, InterruptMode, NewSession, RestartSession, Status, VarAction, VarActionType } from './kcclient/api';
import { JupyterMessage } from './jupyter/JupyterMessage';
import { JupyterRequest } from './jupyter/JupyterRequest';
import { KernelInfoReply, KernelInfoRequest } from './jupyter/KernelInfoRequest';
import { Barrier, PromiseHandles, withTimeout } from './async';
import { ExecuteRequest, JupyterExecuteRequest } from './jupyter/ExecuteRequest';
import { IsCompleteRequest, JupyterIsCompleteRequest } from './jupyter/IsCompleteRequest';
import { CommInfoRequest } from './jupyter/CommInfoRequest';
import { JupyterCommOpen } from './jupyter/JupyterCommOpen';
import { CommOpenCommand } from './jupyter/CommOpenCommand';
import { JupyterCommand } from './jupyter/JupyterCommand';
import { CommCloseCommand } from './jupyter/CommCloseCommand';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { RuntimeMessageEmitter } from './RuntimeMessageEmitter';
import { CommMsgCommand } from './jupyter/CommMsgCommand';
import { ShutdownRequest } from './jupyter/ShutdownRequest';
import { LogStreamer } from './LogStreamer';
import { JupyterMessageHeader } from './jupyter/JupyterMessageHeader';
import { JupyterChannel } from './jupyter/JupyterChannel';
import { InputReplyCommand } from './jupyter/InputReplyCommand';
import { RpcReplyCommand } from './jupyter/RpcReplyCommand';
import { JupyterCommRequest } from './jupyter/JupyterCommRequest';
import { Client } from './Client';
import { CommMsgRequest } from './jupyter/CommMsgRequest';
import { SocketSession } from './ws/SocketSession';
import { KernelOutputMessage } from './ws/KernelMessage';
import { UICommRequest } from './UICommRequest';
import { createUniqueId, summarizeError, summarizeAxiosError } from './util';
import { AdoptedSession } from './AdoptedSession';
import { DebugRequest } from './jupyter/DebugRequest';
import { JupyterMessageType } from './jupyter/JupyterMessageType.js';
import { isAxiosError } from 'axios';
import { KallichoreTransport } from './KallichoreApiInstance.js';
import { JupyterCommClose } from './jupyter/JupyterCommClose';
import { CommBackendRequest, CommRpcMessage, CommImpl } from './Comm';
import { channel, Sender } from './Channel';
import { DapComm } from './DapComm';

/**
 * The reason for a disconnection event.
 */
export enum DisconnectReason {
	/** Normal disconnect after kernel exits. */
	Exit = 'exit',

	/** Abnormal disconnect with no known reason. */
	Unknown = 'unknown',

	/**
	 * Disconnected because the connection was transferred to another client.
	 * This can happen in Server mode when another browser tab is opened with
	 * the same set of sessions as this browser tab.
	 */
	Transferred = 'transferred',
}

/**
 * The event emitted when the session's websocket is disconnected from the kernel.
 */
export interface DisconnectedEvent {
	/** The state of the kernel at the time of the disconnection */
	state: positron.RuntimeState;

	/** The reason for the disconnection */
	reason: DisconnectReason;
}

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	/**
	 * The runtime messages emitter; consumes Jupyter messages and translates
	 * them to Positron language runtime messages
	 */
	private readonly _messages: RuntimeMessageEmitter = new RuntimeMessageEmitter();

	/** Emitter for runtime state changes */
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;

	/** Emitter for runtime exit events */
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;

	/** Emitter for disconnection events  */
	readonly disconnected: vscode.EventEmitter<DisconnectedEvent>;

	/** Barrier: opens when the session has been established on Kallichore */
	private readonly _established: Barrier = new Barrier();

	/** Barrier: opens when the WebSocket is connected and Jupyter messages can
	 * be sent and received */
	private _connected: Barrier = new Barrier();

	/** Cached exit reason; used to indicate an exit is expected so we can
	 * distinguish between expected and unexpected exits */
	private _exitReason: positron.RuntimeExitReason = positron.RuntimeExitReason.Unknown;

	/** The WebSocket connection to the Kallichore server for this session
	 */
	private _socket: SocketSession | undefined;

	/** The current runtime state of this session */
	private _runtimeState: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	/** A map of pending RPCs, used to pair up requests and replies */
	private _pendingRequests: Map<string, JupyterRequest<any, any>> = new Map();

	/** An array of pending UI comm requests */
	private _pendingUiCommRequests: UICommRequest[] = [];

	/** Objects that should be disposed when the session is disposed */
	private _disposables: vscode.Disposable[] = [];

	/** Whether we are currently restarting the kernel */
	private _restarting = false;

	/** Whether it is possible to connect to the session's websocket */
	private _canConnect = true;

	/** A map of pending comm startups */
	private _startingComms: Map<string, PromiseHandles<number>> = new Map();

	/** The original kernelspec */
	private _kernelSpec: JupyterKernelSpec | undefined;

	/**
	 * The channel to which output for this specific kernel is logged, if any
	 */
	private readonly _kernelChannel: vscode.OutputChannel;

	/**
	 * The channel to which output for this specific console is logged
	 */
	private readonly _consoleChannel: vscode.LogOutputChannel;

	/**
	 * The channel to which profile output for this specific kernel is logged, if any
	 */
	private _profileChannel: vscode.OutputChannel | undefined;

	/** A map of active comms connected to Positron clients */
	private readonly _clients: Map<string, Client> = new Map();

	/** A map of active comms unmanaged by Positron */
	private readonly _comms: Map<string, [CommImpl, Sender<CommBackendMessage>]> = new Map();

	/** The kernel's log file, if any. */
	private _kernelLogFile: string | undefined;

	/**
	 * The active session on the Kallichore server. Currently, this is only
	 * defined for sessions that have been restored after reload or navigation.
	 */
	private _activeSession: ActiveSession | undefined;

	/**
	 * The message header for the current requests if any is active.  This is
	 * used for input requests (e.g. from `readline()` in R) Concurrent requests
	 * are not supported.
	 */
	private _activeBackendRequestHeader: JupyterMessageHeader | null = null;

	/** Information about the runtime that is only available after starting */
	private _runtimeInfo: positron.LanguageRuntimeInfo | undefined;

	/**
	 * Constructor for the Kallichore session wrapper.
	 *
	 * @param metadata The session metadata
	 * @param runtimeMetadata The runtime metadata
	 * @param dynState The initial dynamic state of the runtime
	 * @param _api The API instance to use for communication
	 * @param _transport The transport mechanism to use for communication
	 * @param _ensureServerRunning A function that will ensure the Kallichore
	 * server is running
	 * @param _new Set to `true` when the session is created for the first time,
	 * and `false` when it is restored (reconnected).
	 * @param _extra Extra functionality to enable for this session
	 */
	constructor(readonly metadata: positron.RuntimeSessionMetadata,
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly dynState: positron.LanguageRuntimeDynState,
		private _api: DefaultApi,
		private readonly _transport: KallichoreTransport,
		private readonly _ensureServerRunning: () => Promise<void>,
		private readonly _new: boolean,
		private readonly _extra?: JupyterKernelExtra | undefined) {

		// Create event emitters
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
		this.disconnected = new vscode.EventEmitter<DisconnectedEvent>();

		// Ensure the emitters are disposed when the session is disposed
		this._disposables.push(this._messages);
		this._disposables.push(this._state);
		this._disposables.push(this._exit);
		this._disposables.push(this.disconnected);

		this.onDidReceiveRuntimeMessage = this._messages.event;

		this.onDidChangeRuntimeState = this._state.event;

		this.onDidEndSession = this._exit.event;

		// Establish log channels for the console and kernel we're connecting to
		this._consoleChannel = vscode.window.createOutputChannel(
			metadata.notebookUri ?
				`${runtimeMetadata.runtimeName}: Notebook: (${path.basename(metadata.notebookUri.path)})` :
				`${runtimeMetadata.runtimeName}: Console`,
			{ log: true });

		this._kernelChannel = positron.window.createRawLogOutputChannel(
			`${runtimeMetadata.runtimeName}: Kernel`);
		this._kernelChannel.appendLine(`** Begin kernel log for session ${dynState.sessionName} (${metadata.sessionId}) at ${new Date().toLocaleString()} **`);
	}

	/**
	 * Builds the set of environment variable actions to be applied to the
	 * kernel when starting or restarting.
	 *
	 * @params restart Whether this is a restart or a new session
	 *
	 * @returns An array of environment variable actions
	 */
	async buildEnvVarActions(restart: boolean): Promise<VarAction[]> {
		const varActions: Array<VarAction> = [];

		// Built-in variable POSITRON is always set to 1 to indicate that
		// this is a Positron session.
		varActions.push({
			action: VarActionType.Replace, name: 'POSITRON',
			value: '1'
		});

		// The Positron version.
		varActions.push({
			action: VarActionType.Replace, name: 'POSITRON_VERSION',
			value: positron.version
		});

		// The long form of the Positron version (includes build number).
		varActions.push({
			action: VarActionType.Replace, name: 'POSITRON_LONG_VERSION',
			value: `${positron.version}+${positron.buildNumber}`
		});

		// The Positron mode (desktop or server)
		varActions.push({
			action: VarActionType.Replace,
			name: 'POSITRON_MODE',
			value: vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'server'
		});

		// Start with the environment variables from any extension's contributions.
		const contributedVars = await positron.environment.getEnvironmentContributions();
		for (const [extensionId, actions] of Object.entries(contributedVars)) {

			if (restart && extensionId === 'ms-python.python') {
				// The variables contributed by the Python extension are
				// intended for the "current" version of Python, which isn't
				// necessarily the version we are restarting here.
				// Ignore these for now, but consider: there should be a scoping
				// mechanism of some kind that would allow us to work with these
				// kinds of values.
				continue;
			}

			for (const action of actions) {
				// Convert VS Code's environment variable action type to our
				// internal Kallichore API type
				let actionType: VarActionType;
				switch (action.action) {
					case vscode.EnvironmentVariableMutatorType.Replace:
						actionType = VarActionType.Replace;
						break;
					case vscode.EnvironmentVariableMutatorType.Append:
						actionType = VarActionType.Append;
						break;
					case vscode.EnvironmentVariableMutatorType.Prepend:
						actionType = VarActionType.Prepend;
						break;
					default:
						this.log(`Unknown environment variable action type ${action.action} ` +
							`for extension ${extensionId}, ${action.name} => ${action.value}; ignoring`,
							vscode.LogLevel.Error);
						continue;
				}

				// Construct the variable action and add it to the list
				const varAction: VarAction = {
					action: actionType,
					name: action.name,
					value: action.value
				};
				varActions.push(varAction);
			}
		}

		// Amend with any environment variables from the kernel spec; each becomes
		// a "replace" variable action since it overrides the default value if
		// set.
		//
		// This is done after the contributed variables so that the kernel spec
		// variables take precedence.
		if (this._kernelSpec?.env) {
			for (const [key, value] of Object.entries(this._kernelSpec.env)) {
				if (typeof value === 'string') {
					const action: VarAction = {
						action: VarActionType.Replace,
						name: key,
						value
					};
					varActions.push(action);
				}
			}
		}

		return varActions;
	}

	/**
	 * Create the session in on the Kallichore server.
	 *
	 * @param kernelSpec The Jupyter kernel spec to use for the session
	 */
	public async create(kernelSpec: JupyterKernelSpec) {
		if (!this._new) {
			throw new Error(`Session ${this.metadata.sessionId} already exists`);
		}

		// Save the kernel spec for later use
		this._kernelSpec = kernelSpec;
		const varActions = await this.buildEnvVarActions(false);

		let workingDir = this.metadata.workingDirectory;
		if (!workingDir) {
			// Use the workspace root if available, otherwise the home directory
			workingDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath || os.homedir();
		}

		// Form the command-line arguments to the kernel process
		const tempdir = os.tmpdir();
		const sep = path.sep;
		const kerneldir = fs.mkdtempSync(`${tempdir}${sep}kernel-`);
		const logFile = path.join(kerneldir, 'kernel.log');
		const profileFile = path.join(kerneldir, 'kernel-profile.log');
		const args = kernelSpec.argv.map((arg, _idx) => {

			// Replace {log_file} with the log file path. Not all kernels
			// have this argument.
			if (arg === '{log_file}') {
				fs.writeFile(logFile, '', async () => {
					await this.streamLogFile(logFile);
				});
				return logFile;
			}

			// Same as `log_file` but for profiling logs
			if (profileFile && arg === '{profile_file}') {
				fs.writeFile(profileFile, '', async () => {
					await this.streamProfileFile(profileFile);
				});
				return profileFile;
			}

			return arg;
		}) as Array<string>;

		// Default to message-based interrupts
		let interruptMode: 'signal' | 'message' = InterruptMode.Message;

		// If the kernel spec specifies an interrupt mode, use it
		if (kernelSpec.interrupt_mode) {
			switch (kernelSpec.interrupt_mode) {
				case 'signal':
					interruptMode = InterruptMode.Signal;
					break;
				case 'message':
					interruptMode = InterruptMode.Message;
					break;
			}
		}

		// Initialize extra functionality, if any. These settings modify the
		// argument list `args` in place, so need to happen right before we send
		// the arg list to the server.
		const config = vscode.workspace.getConfiguration('kernelSupervisor');
		const attachOnStartup = config.get('attachOnStartup', false) && this._extra?.attachOnStartup;
		const sleepOnStartup = config.get('sleepOnStartup', undefined) && this._extra?.sleepOnStartup;
		const connectionTimeout = config.get('connectionTimeout', 30);
		if (attachOnStartup) {
			this._extra!.attachOnStartup!.init(args);
		}
		if (sleepOnStartup) {
			const delay = config.get('sleepOnStartup', 0);
			this._extra!.sleepOnStartup!.init(args, delay);
		}

		// Whether to run the kernel in a login shell. Kallichore ignores this
		// on Windows.
		const runInShell = config.get('runInShell', false);

		// Create the session in the underlying API
		const session: NewSession = {
			argv: args,
			session_id: this.metadata.sessionId,
			language: kernelSpec.language,
			display_name: this.dynState.sessionName,
			input_prompt: '',
			continuation_prompt: '',
			env: varActions,
			working_directory: workingDir,
			run_in_shell: runInShell,
			username: os.userInfo().username,
			interrupt_mode: interruptMode,
			connection_timeout: connectionTimeout,
			protocol_version: kernelSpec.kernel_protocol_version
		};
		await this._api.newSession(session);
		this.log(`${kernelSpec.display_name} session '${this.metadata.sessionId}' created in ${workingDir} with command:`, vscode.LogLevel.Info);
		this.log(args.join(' '), vscode.LogLevel.Info);
		this._established.open();
	}

	/**
	 * Requests that the kernel start a Language Server Protocol server, and
	 * connect it to the client with the given TCP address.
	 *
	 * Note: This is only useful if the kernel hasn't already started an LSP
	 * server.
	 *
	 * @param clientId The ID of the client comm, created with
	 *  `createPositronLspClientId()`.
	 * @param ipAddress The address of the client that will connect to the
	 *  language server.
	 */
	async startPositronLsp(clientId: string, ipAddress: string): Promise<number> {
		this.log(`Starting LSP server ${clientId} for ${ipAddress}`, vscode.LogLevel.Info);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		// Ask the backend to create the client
		await this.createClient(
			clientId,
			positron.RuntimeClientType.Lsp,
			{ ip_address: ipAddress }
		);

		// Create a promise that will resolve when the LSP starts on the server
		// side.
		const startPromise = new PromiseHandles<number>();
		this._startingComms.set(clientId, startPromise);
		return startPromise.promise;
	}

	createPositronLspClientId(): string {
		return `positron-lsp-${this.runtimeMetadata.languageId}-${createUniqueId()}`;
	}

	/** Create a raw server comm. See `positron-supervisor.d.ts` for documentation. */
	async createServerComm(target_name: string, ip_address: string): Promise<[Comm, number]> {
		this.log(`Starting server comm '${target_name}' for ${ip_address}`);
		const comm = await this.createComm(target_name, { ip_address });

		const result = await comm.receiver.next();

		if (result.done) {
			comm.dispose();
			throw new Error('Comm was closed before sending a `server_started` message');
		}

		const message = result.value;

		if (message.method !== 'server_started') {
			comm.dispose();
			throw new Error('Comm was closed before sending a `server_started` message');
		}

		const serverStarted = message.params as any;
		const port = serverStarted.port;

		if (typeof port !== 'number') {
			comm.dispose();
			throw new Error('`server_started` message doesn\'t include a port');
		}

		this.log(`Started server comm '${target_name}' for ${ip_address} on port ${port}`);
		return [comm, port];
	}

	/**
	 * Forwards a message to the Jupyter log output channel.
	 *
	 * @param message The message to log
	 * @param logLevel The log level of the message
	 */
	emitJupyterLog(message: string, logLevel?: vscode.LogLevel): void {
		this.log(message, logLevel);
	}

	/**
	 * Reveals the output channel for this kernel.
	 */
	showOutput(channel?: positron.LanguageRuntimeSessionChannel): void {
		switch (channel) {
			case positron.LanguageRuntimeSessionChannel.Kernel:
				this._kernelChannel?.show();
				break;
			case positron.LanguageRuntimeSessionChannel.Console:
				this._consoleChannel.show();
				break;
			case undefined:
				this._kernelChannel.show();
				break;
			default:
				throw new Error(`Unknown output channel ${channel}`);
		}
	}


	/**
	 * Get a list of output channels
	 * @returns A list of output channels available on this runtime
	 */
	listOutputChannels(): positron.LanguageRuntimeSessionChannel[] {
		// We always have a console channel and a kernel channel
		const channels = [positron.LanguageRuntimeSessionChannel.Console, positron.LanguageRuntimeSessionChannel.Kernel];
		return channels;
	}

	/**
	 * Calls a method on the UI comm for this kernel.
	 *
	 * @param method The method's name
	 * @param args Additional arguments to pass to the method
	 * @returns The result of the method call
	 */
	callMethod(method: string, ...args: Array<any>): Promise<any> {
		const promise = new PromiseHandles;

		// Create the request
		const request = new UICommRequest(method, args, promise);

		// Find the UI comm
		const uiComm = Array.from(this._clients.values())
			.find(c => c.target === positron.RuntimeClientType.Ui);

		if (!uiComm) {
			// No comm open yet?  No problem, we'll call the method when the
			// comm is opened.
			this._pendingUiCommRequests.push(request);
			this.log(`No UI comm open yet; queueing request '${method}'`, vscode.LogLevel.Debug);
			return promise.promise;
		}

		return this.performUiCommRequest(request, uiComm.id);
	}

	/**
	 * Performs a UI comm request.
	 *
	 * @param req The request to perform
	 * @param uiCommId  The ID of the UI comm
	 * @returns The result of the request
	 */
	performUiCommRequest(req: UICommRequest, uiCommId: string): Promise<any> {
		// NOTE: Currently using nested RPC messages for convenience but
		// we'd like to do better
		const request = {
			jsonrpc: '2.0',
			method: 'call_method',
			params: {
				method: req.method,
				params: req.args
			},
			id: createUniqueId(),
		};

		const commMsg: JupyterCommMsg = {
			comm_id: uiCommId,
			data: request
		};

		const commRequest = new CommMsgRequest(createUniqueId(), commMsg);
		this.sendRequest(commRequest).then((reply) => {
			const response = reply.data;

			// If the response is an error, throw it
			if (Object.keys(response).includes('error')) {
				// TODO: Could be more type-safe
				const error = response.error as any;

				// Populate the error object with the name of the error code
				// for conformity with code that expects an Error object.
				error.name = `RPC Error ${error.code}`;

				req.promise.reject(error);
			}

			// JSON-RPC specifies that the return value must have either a 'result'
			// or an 'error'; make sure we got a result before we pass it back.
			if (!Object.keys(response).includes('result')) {
				const error: positron.RuntimeMethodError = {
					code: positron.RuntimeMethodErrorCode.InternalError,
					message: `Invalid response from UI comm: no 'result' field. ` +
						`(response = ${JSON.stringify(response)})`,
					name: `InvalidResponseError`,
					data: {},
				};

				req.promise.reject(error);
			}

			// Otherwise, return the result
			req.promise.resolve(response.result);
		})
			.catch((err) => {
				this.log(`Failed to send UI comm request: ${JSON.stringify(err)}`, vscode.LogLevel.Error);
				req.promise.reject(err);
			});

		return req.promise.promise;
	}

	/**
	 * Gets the path to the kernel's log file, if any.
	 *
	 * @returns The kernel's log file.
	 * @throws An error if the log file is not available.
	 */
	getKernelLogFile(): string {
		if (!this._kernelLogFile) {
			throw new Error('Kernel log file not available');
		}
		return this._kernelLogFile;
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	/**
	 * Sends a Debug Adapter Protocol request to the runtime's debugger.
	 *
	 * @param request The Debug Adapter Protocol request.
	 * @returns The Debug Adapter Protocol response.
	 */
	async debug(request: positron.DebugProtocolRequest): Promise<positron.DebugProtocolResponse> {
		const debug = new DebugRequest(request);
		return await this.sendRequest(debug);
	}

	/**
	 * Requests that the kernel execute a code fragment.
	 *
	 * @param code The code to execute
	 * @param id An ID for the code fragment; used to identify output and errors
	 * that come from this code fragment.
	 * @param mode The execution mode
	 * @param errorBehavior What to do if an error occurs
	 */
	execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		// Translate the parameters into a Jupyter execute request
		const request: JupyterExecuteRequest = {
			code,
			silent: mode === positron.RuntimeCodeExecutionMode.Silent,
			store_history: mode === positron.RuntimeCodeExecutionMode.Interactive,
			user_expressions: {},
			allow_stdin: true,
			stop_on_error: errorBehavior === positron.RuntimeErrorBehavior.Stop,
		};

		// Create and send the execute request
		const execute = new ExecuteRequest(id, request);
		this.sendRequest(execute).then((reply) => {
			this.log(`Execution result: ${JSON.stringify(reply)}`, vscode.LogLevel.Debug);
		}).catch((err) => {
			// This should be exceedingly rare; it represents a failure to send
			// the request to Kallichore rather than a failure to execute it
			this.log(`Failed to send execution request for '${code}': ${err}`, vscode.LogLevel.Error);
		});
	}

	/**
	 * Tests whether a code fragment is complete.
	 * @param code The code to test
	 * @returns The status of the code fragment
	 */
	async isCodeFragmentComplete(code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		// Form the Jupyter request
		const request: JupyterIsCompleteRequest = {
			code
		};
		const isComplete = new IsCompleteRequest(request);
		const reply = await this.sendRequest(isComplete);
		switch (reply.status) {
			case 'complete':
				return positron.RuntimeCodeFragmentStatus.Complete;
			case 'incomplete':
				return positron.RuntimeCodeFragmentStatus.Incomplete;
			case 'invalid':
				return positron.RuntimeCodeFragmentStatus.Invalid;
			case 'unknown':
				return positron.RuntimeCodeFragmentStatus.Unknown;
		}
	}

	/** Create raw comm. See `positron-supervisor.d.ts` for documentation. */
	async createComm(
		target_name: string,
		params: Record<string, unknown> = {},
	): Promise<Comm> {
		const id = `extension-comm-${target_name}-${this.runtimeMetadata.languageId}-${createUniqueId()}`;

		const [tx, rx] = channel<CommBackendMessage>();
		const comm = new CommImpl(id, this, rx);
		this._comms.set(id, [comm, tx]);

		// Disposal handler that allows extension to initiate close comm
		comm.register({
			dispose: () => {
				// If already deleted, it means a `comm_close` from the backend was
				// received and we don't need to send one.
				if (this._comms.delete(id)) {
					comm.closeAndNotify();
				}
			}
		});

		const msg: JupyterCommOpen = {
			target_name,
			comm_id: id,
			data: params,
		};
		const commOpen = new CommOpenCommand(msg);
		await this.sendCommand(commOpen);

		return comm as Comm;
	}

	/** Create DAP comm. See `positron-supervisor.d.ts` for documentation. */
	async createDapComm(
		targetName: string,
		debugType: string,
		debugName: string,
	): Promise<DapComm> {
		const comm = new DapComm(this, targetName, debugType, debugName);
		await comm.createComm();
		return comm;
	}

	/**
	 * Create a new client comm.
	 *
	 * @param id The ID of the client comm; must be unique among all comms
	 * connected to this kernel
	 * @param type The type of client comm to create
	 * @param params The parameters to pass to the client comm
	 * @param metadata Additional metadata to pass to the client comm
	 */
	async createClient(
		id: string,
		type: positron.RuntimeClientType,
		params: Record<string, unknown>,
		metadata?: Record<string, unknown>): Promise<void> {

		// Ensure the type of client we're being asked to create is a known type that supports
		// client-initiated creation
		if (type === positron.RuntimeClientType.Variables ||
			type === positron.RuntimeClientType.Lsp ||
			type === positron.RuntimeClientType.Ui ||
			type === positron.RuntimeClientType.Help ||
			type === positron.RuntimeClientType.IPyWidgetControl) {

			const msg: JupyterCommOpen = {
				target_name: type,
				comm_id: id,
				data: params
			};
			const commOpen = new CommOpenCommand(msg, metadata);
			await this.sendCommand(commOpen);
			this._clients.set(id, new Client(id, type));

			// If we have any pending UI comm requests and we just created the
			// UI comm, send them now
			if (type === positron.RuntimeClientType.Ui) {
				this.sendPendingUiCommRequests(id).then(() => {
					this.log(`Sent pending UI comm requests to ${id}`, vscode.LogLevel.Trace);
				});
			}
		} else {
			this.log(`Can't create ${type} client for ${this.runtimeMetadata.languageName} (not supported)`, vscode.LogLevel.Error);
		}
	}

	/**
	 * Get a list of open clients (comms) from the kernel.
	 *
	 * @param type The type of client to list, or undefined to list all clients
	 * @returns A map of client IDs to client names (targets)
	 */
	async listClients(type?: positron.RuntimeClientType): Promise<Record<string, string>> {
		const request = new CommInfoRequest(type || '');
		const reply = await this.sendRequest(request);
		const result: Record<string, string> = {};
		const comms = reply.comms;
		// Unwrap the comm info and add it to the result
		for (const key in comms) {
			// Don't list as client if this is an unmanaged comm
			if (this._comms.has(key)) {
				continue;
			}

			if (comms.hasOwnProperty(key)) {
				const target = comms[key].target_name;
				result[key] = target;
				// If we don't have a comm object for this comm, create one
				if (!this._clients.has(key)) {
					this._clients.set(key, new Client(key, target));
				}

				// If we just discovered a UI comm, send any pending UI comm
				// requests to it.
				if (target === positron.RuntimeClientType.Ui) {
					this.sendPendingUiCommRequests(key).then(() => {
						this.log(`Sent pending UI comm requests to ${key}`, vscode.LogLevel.Trace);
					});
				}
			}
		}
		return result;
	}

	removeClient(id: string): void {
		this._clients.delete(id);

		// Ignore this if the session is already exited; an exited session has
		// no clients
		if (this._runtimeState === positron.RuntimeState.Exited) {
			this.log(`Ignoring request to close comm ${id}; kernel has already exited`, vscode.LogLevel.Debug);
			return;
		}
		const commClose = new CommCloseCommand(id);
		this.sendCommand(commClose);
	}

	/**
	 * Sends a message to an open comm.
	 *
	 * @param client_id The ID of the client comm to send the message to
	 * @param message_id The ID of the message to send; used to help match
	 * replies
	 * @param message The message to send
	 */
	sendClientMessage(client_id: string, message_id: string, message: any): void {
		const msg: JupyterCommMsg = {
			comm_id: client_id,
			data: message
		};
		const commMsg = new CommMsgCommand(message_id, msg);
		this.sendCommand(commMsg).then(() => {
			// Nothing to do here; the message was sent successfully
		}).catch((err) => {
			this.log(`Failed to send message ${JSON.stringify(message)} to ${client_id}: ${err}`, vscode.LogLevel.Error);
		});
	}

	/**
	 * Sends a reply to an input prompt to the kernel.
	 *
	 * @param id The ID of the input request to reply to
	 * @param value The value to send as a reply
	 */
	replyToPrompt(id: string, value: string): void {
		if (!this._activeBackendRequestHeader) {
			this.log(`Failed to find parent for input request ${id}; sending anyway: ${value}`, vscode.LogLevel.Warning);
			return;
		}
		const reply = new InputReplyCommand(this._activeBackendRequestHeader, value);
		this.log(`Sending input reply for ${id}: ${value}`, vscode.LogLevel.Debug);
		this.sendCommand(reply);
	}

	/**
	 * Set the working directory for the kernel. This is a stub implementation since Jupyter
	 * doesn't have a concept of a working directory.
	 *
	 * @param workingDirectory The working directory to set
	 * @returns Nothing
	 * @throws An error message indicating that this method is not implemented
	 */
	setWorkingDirectory(workingDirectory: string): Promise<void> {
		return Promise.reject(
			`Cannot change working directory to ${workingDirectory} (not implemented)`);
	}

	/**
	 * Restores an existing session from the server.
	 *
	 * @param session The session to restore
	 */
	async restore(session: ActiveSession) {
		// Re-establish the log stream by looking for the `--log` or `--logfile`
		// arguments.
		//
		// CONSIDER: This is a convention used by the R and Python kernels but
		// may not be reliable for other kernels. We could handle it more
		// generically by storing this information in the session metadata.
		for (const arg of ['--log', '--logfile']) {
			const logFileIndex = session.argv.indexOf(arg);
			if (logFileIndex > 0 && logFileIndex < session.argv.length - 1) {
				const logFile = session.argv[logFileIndex + 1];
				if (fs.existsSync(logFile)) {
					await this.streamLogFile(logFile);
					break;
				}
			}
		}

		// Do the same for the profile file
		const profileFileIndex = session.argv.indexOf('--profile');
		if (profileFileIndex > 0 && profileFileIndex < session.argv.length - 1) {
			const profileFile = session.argv[profileFileIndex + 1];
			if (fs.existsSync(profileFile)) {
				this.streamProfileFile(profileFile);
			}
		}

		// Save the kernel info
		this.runtimeInfoFromKernelInfo(session.kernel_info as KernelInfoReply);

		// Open the established barrier so that we can start sending messages
		this._activeSession = session;
		this._established.open();
	}

	/**
	 * Starts and then adopts a kernel owned by an external provider.
	 *
	 * @param kernelSpec The kernel spec to use for the session
	 * @returns The runtime info for the kernel
	 */
	async startAndAdoptKernel(
		kernelSpec: JupyterKernelSpec):
		Promise<positron.LanguageRuntimeInfo> {

		// Mark the session as starting
		this.onStateChange(positron.RuntimeState.Starting, 'starting kernel via external provider');

		try {
			const result = await this.tryStartAndAdoptKernel(kernelSpec);
			return result;
		} catch (err) {
			// If we never made it to the "ready" state, mark the session as
			// exited since we didn't ever start it fully.
			if (this._runtimeState === positron.RuntimeState.Starting) {
				const event: positron.LanguageRuntimeExit = {
					runtime_name: this.runtimeMetadata.runtimeName,
					session_name: this.dynState.sessionName,
					exit_code: 0,
					reason: positron.RuntimeExitReason.StartupFailed,
					message: summarizeError(err)
				};
				this._exit.fire(event);
				this.onStateChange(positron.RuntimeState.Exited, 'kernel adoption failed');
			}
			throw err;
		}
	}

	/**
	 * Updates the API instance used by this session.
	 *
	 * @param api The new API instance to use.
	 */
	public refreshApi(api: DefaultApi) {
		this._api = api;
	}

	/**
	 * Tries to start and then adopt a kernel owned by an external provider.
	 *
	 * @param kernelSpec The kernel spec to use for the session
	 */
	async tryStartAndAdoptKernel(kernelSpec: JupyterKernelSpec): Promise<positron.LanguageRuntimeInfo> {

		// Get the connection info for the session
		let connectionInfo: ConnectionInfo;
		try {
			// Read the connection info from the API. This arrives to us in the
			// form of a `ConnectionInfo` object.
			const result = await this._api.connectionInfo(this.metadata.sessionId);
			connectionInfo = result.data;
		} catch (err) {
			throw new Error(`Failed to aquire connection info for session ${this.metadata.sessionId}: ${summarizeError(err)}`);
		}

		// Ensure we have a log file
		if (!this._kernelLogFile) {
			const logFile = path.join(os.tmpdir(), `kernel-${this.metadata.sessionId}.log`);
			this._kernelLogFile = logFile;
			fs.writeFile(logFile, '', async () => {
				await this.streamLogFile(logFile);
			});
		}

		// Write the connection file to disk
		const connectionFile = path.join(os.tmpdir(), `connection-${this.metadata.sessionId}.json`);
		fs.writeFileSync(connectionFile, JSON.stringify(connectionInfo));
		const session: JupyterSession = {
			state: {
				sessionId: this.metadata.sessionId,
				connectionFile: connectionFile,
				logFile: this._kernelLogFile,
				processId: 0,
			}
		};

		// Create the "kernel"
		const kernel = new AdoptedSession(this, connectionInfo, this._api);

		// Start the kernel and wait for it to be ready
		await kernelSpec.startKernel!(session, kernel);

		// Wait for session adoption to finish
		await kernel.connected.wait();

		// Connect to the session's websocket
		await withTimeout(this.connect(), 2000, `Start failed: timed out connecting to adopted session ${this.metadata.sessionId}`);

		// Mark the session as ready
		this.markReady('kernel adoption complete');

		// Return the runtime info from the adopted session
		const info = kernel.runtimeInfo;
		if (info) {
			return this.runtimeInfoFromKernelInfo(info);
		} else {
			return this.getKernelInfo();
		}
	}

	/**
	 * Starts a previously established session.
	 *
	 * This method is used both to start a new session and to reconnect to an
	 * existing session.
	 *
	 * @returns The kernel info for the session.
	 */
	async start(): Promise<positron.LanguageRuntimeInfo> {
		// If this session needs to be started by an external provider, do that
		// instead of asking the supervisor to start it.
		if (this._kernelSpec?.startKernel) {
			return this.startAndAdoptKernel(this._kernelSpec);
		}

		try {
			// Attempt to start the session
			const info = await this.tryStart(true);
			return info;
		} catch (err) {
			if (isAxiosError(err) && err.status === 500) {
				// When the server returns a 500 error, it means the startup
				// failed. In this case the API returns a structured startup
				// error we can use to report the problem with more detail.
				const startupErr = err.response?.data;
				let message = startupErr.error.message;
				if (startupErr.output) {
					message += `\n${startupErr.output}`;
				}
				const event: positron.LanguageRuntimeExit = {
					runtime_name: this.runtimeMetadata.runtimeName,
					session_name: this.dynState.sessionName,
					exit_code: startupErr.exit_code ?? 0,
					reason: positron.RuntimeExitReason.StartupFailed,
					message
				};
				this._exit.fire(event);
			} else {
				// This indicates that startup failed due to a problem on the
				// client side. We still need to report an exit so that the UI
				// treats the runtime as exited.

				// Attempt to extract a message from the error, or just
				// stringify it if it's not an Error
				const event: positron.LanguageRuntimeExit = {
					runtime_name: this.runtimeMetadata.runtimeName,
					session_name: this.dynState.sessionName,
					exit_code: 0,
					reason: positron.RuntimeExitReason.StartupFailed,
					message: summarizeError(err)
				};
				this._exit.fire(event);
			}

			this.onStateChange(positron.RuntimeState.Exited, 'startup failed');
			throw err;
		}
	}

	/**
	 * Attempts to start the session; returns a promise that resolves when the
	 * session is ready to use.
	 *
	 * @param retry Whether to retry starting the session if it fails due to
	 * the server not being available.
	 */
	private async tryStart(retry: boolean): Promise<positron.LanguageRuntimeInfo> {
		// Wait for the session to be established before connecting. This
		// ensures either that we've created the session (if it's new) or that
		// we've restored it (if it's not new).
		await withTimeout(this._established.wait(), 2000, `Start failed: timed out waiting for session ${this.metadata.sessionId} to be established`);

		let runtimeInfo: positron.LanguageRuntimeInfo | undefined = this._runtimeInfo;

		// Mark the session as starting
		this.onStateChange(positron.RuntimeState.Starting, 'invoking start API');

		// If it's a new session, wait for it to be created before connecting
		if (this._new) {
			try {
				const result = await this._api.startSession(this.metadata.sessionId);
				// Typically, the API returns the kernel info as the result of
				// starting a new session, but the server doesn't validate the
				// result returned by the kernel, so check for a `status` field
				// before assuming it's a Jupyter message.
				if (result.data.status === 'ok') {
					runtimeInfo = this.runtimeInfoFromKernelInfo(result.data);
				}
			} catch (err) {
				if (!retry) {
					throw err;
				}
				if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
					// If it looks like the server is not running, try to
					// start it and then try again.
					this.log(`Server not available; attempting to start it: ${summarizeError(err)}`, vscode.LogLevel.Warning);

					// Ensure the server is running
					await this._ensureServerRunning();

					// Try to start the session again, but don't retry again
					return this.tryStart(false);
				} else {
					// Some other error; just rethrow it
					throw err;
				}
			}
		}

		// Before connecting, check if we should attach to the session on
		// startup
		const config = vscode.workspace.getConfiguration('kernelSupervisor');
		const attachOnStartup = config.get('attachOnStartup', false) && this._extra?.attachOnStartup;
		if (attachOnStartup) {
			try {
				await this._extra!.attachOnStartup!.attach();
			} catch (err) {
				this.log(`Can't execute attach action: ${err}`, vscode.LogLevel.Error);
			}
		}

		// Connect to the session's websocket
		await withTimeout(this.connect(), 2000, `Start failed: timed out connecting to session ${this.metadata.sessionId}`);

		if (this._new) {
			// If it's a new session and we got runtime info from starting it,
			// we're ready to go.
			if (runtimeInfo) {
				this.markReady('new session');
			}
		} else if (this._activeSession?.status === Status.Busy) {
			// If we're reconnecting to a session that's busy, we need to wait
			// for it to become idle before we can mark it as ready.
			this.waitForIdle().then(() => {
				this.markReady('idle after busy reconnect');
			});
		}

		// If we don't have runtime info yet, get it now.
		if (!runtimeInfo) {
			runtimeInfo = await this.getKernelInfo();
			this.markReady('idle after getting kernel info');
		}

		return runtimeInfo;
	}

	/**
	 * Requests that the user confirm whether they want to interrupt the
	 * session that is currently busy so that we can reconnect to it.
	 *
	 * @param progress The progress report to update with the status of the
	 *  interrupt request.
	 */
	private requestReconnectInterrupt() {
		// Show a confirmation dialog to the user asking if they want to
		// interrupt the session.
		positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Interrupt {0}', this.dynState.sessionName),
			vscode.l10n.t('Positron is waiting for {0} to complete work; it will reconnect automatically when {1} becomes idle. Do you want to interrupt the active computation in order to reconnect now?', this.runtimeMetadata.languageName, this.runtimeMetadata.languageName),
			vscode.l10n.t('Interrupt'),
			vscode.l10n.t('Wait'),
		).then((result) => {
			if (!result) {
				// A fun feature of the VS Code API is that it takes down
				// progress dialogs after the user invokes the cancellation
				// operation. So if the user chooses to wait, we need to show a
				// new progress dialog to continue waiting for the session to
				// become idle.
				//
				// It does NOT however prevent the original progress callback
				// from running, so this callback differs from the one in
				// `start()` in that it does not mark the session as ready (that
				// will happen in the original callback).
				vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t('{0} is busy; continuing to wait for it to become idle.', this.dynState.sessionName),
					cancellable: true,
				}, async (_progress, token) => {
					const disposable = token.onCancellationRequested(() => {
						this.requestReconnectInterrupt();
					});
					try {
						await this.waitForIdle();
					} finally {
						disposable.dispose();
					}
				});
				return;
			}

			// The user chose to interrupt; send the interrupt request to the
			// API. This will send an interrupt request to the kernel's control
			// socket, which will then stop the current execution and
			// (hopefully) return to idle.
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Interrupting {0}', this.dynState.sessionName),
				cancellable: false,
			}, async (_progress, _token) => {
				try {
					await this._api.interruptSession(this.metadata.sessionId);
				} catch (err) {
					// If the interrupt failed, log the error and report it to the
					// user. The session will continue to be busy, so we keep the
					// progress report up.
					this.log(`Failed to interrupt session ${this.metadata.sessionId}: ${summarizeError(err)}`, vscode.LogLevel.Error);
					vscode.window.showErrorMessage(vscode.l10n.t('Failed to interrupt {0}: {1}', this.dynState.sessionName, summarizeError(err)));
				}
			});
		});
	}

	/**
	 * Waits for the session to become idle.
	 *
	 * @returns A promise that resolves when the session is idle. Does not time
	 * out or reject.
	 */
	async waitForIdle(): Promise<void> {
		return new Promise((resolve, _reject) => {
			this._state.event(async (state) => {
				if (state === positron.RuntimeState.Idle) {
					resolve();
				}
			});
		});
	}

	/**
	 * Fires the ready event.
	 */
	private markReady(reason: string) {
		// Move into the ready state if we're not already there
		if (this._runtimeState !== positron.RuntimeState.Ready) {
			this.onStateChange(positron.RuntimeState.Ready, reason);
		}
	}

	/**
	 * Determines the WebSocket URI for the session based on the API base path
	 * and transport type.
	 *
	 * @returns The websocket URI for the session.
	 */
	async getWebsocketUri(): Promise<string> {
		// @ts-ignore
		const basePath = this._api.basePath;
		let wsUri: string;

		if (this._transport === KallichoreTransport.UnixSocket) {
			// Unix domain socket transport - get socket path from channelsUpgrade API
			this.log(
				`Using Unix domain socket transport, getting socket path for session ${this.metadata.sessionId}`,
				vscode.LogLevel.Debug);
			const channelsResponse = await this._api.channelsUpgrade(this.metadata.sessionId);
			const socketPath = channelsResponse.data;

			// The socket path might be returned with or without the ws+unix:// prefix
			if (socketPath.startsWith('ws+unix://')) {
				// Already a complete WebSocket URI
				wsUri = socketPath;
			} else if (socketPath.startsWith('/')) {
				// Raw socket path, construct WebSocket URI
				wsUri = `ws+unix://${socketPath}:/api/channels/${this.metadata.sessionId}`;
			} else {
				// Fallback: assume it's a relative path from the Unix socket
				const socketMatch = basePath.match(/unix:([^:]+):/);
				if (socketMatch) {
					const baseSocketPath = socketMatch[1];
					wsUri = `ws+unix://${baseSocketPath}:/api/channels/${this.metadata.sessionId}`;
				} else {
					throw new Error(`Cannot extract socket path from base path: ${basePath}`);
				}
			}
		} else if (this._transport === KallichoreTransport.NamedPipe) {
			// Named pipe transport - get pipe name from channelsUpgrade API
			this.log(
				`Using named pipe transport, getting pipe name for session ${this.metadata.sessionId}`,
				vscode.LogLevel.Debug
			);
			const channelsResponse = await this._api.channelsUpgrade(this.metadata.sessionId);
			const pipeName = channelsResponse.data;

			// The pipe name might be returned with or without the ws+npipe:// prefix
			if (pipeName.startsWith('ws+npipe://')) {
				// Already a complete WebSocket URI
				wsUri = pipeName;
			} else if (pipeName.startsWith('\\\\.\\pipe\\') || pipeName.includes('pipe\\')) {
				// Raw pipe name with full path or partial path, construct WebSocket URI
				wsUri = `ws+npipe://${pipeName}:/api/channels/${this.metadata.sessionId}`;
			} else {
				// Fallback: assume it's a relative pipe name from the base pipe
				const pipeMatch = basePath.match(/npipe:([^:]+):/);
				if (pipeMatch) {
					const basePipeName = pipeMatch[1];
					// If the base pipe name doesn't have the full path, construct it
					const fullPipeName = basePipeName.startsWith('\\\\.\\pipe\\') ?
						basePipeName :
						(basePipeName.startsWith('pipe\\') ? `\\\\.\\${basePipeName}` : `\\\\.\\pipe\\${basePipeName}`);
					wsUri = `ws+npipe://${fullPipeName}:/api/channels/${this.metadata.sessionId}`;
				} else {
					throw new Error(`Cannot extract pipe name from base path: ${basePath}`);
				}
			}
		} else {
			// TCP transport - construct WebSocket URI directly from base path
			this.log(`Using TCP transport, constructing WebSocket URI from base path: ${basePath}`, vscode.LogLevel.Debug);
			if (!basePath) {
				throw new Error('API base path is not set for TCP transport');
			}

			// Convert HTTP base path to WebSocket URI
			const wsScheme = basePath.startsWith('https://') ? 'wss://' : 'ws://';
			const baseUrl = basePath.replace(/^https?:\/\//, '').replace(/\/$/, '');
			wsUri = `${wsScheme}${baseUrl}/sessions/${this.metadata.sessionId}/channels`;
		}
		return wsUri;
	}

	/**
	 * Connects or reconnects to the session's websocket.
	 *
	 * @returns A promise that resolves when the websocket is connected.
	 */
	async connect(): Promise<void> {
		// Ensure we are eligible for reconnection. We can't reconnect if
		// another client is connected to the session as it would disconnect the
		// other client.
		if (!this._canConnect) {
			return Promise.reject(new Error('This session cannot be reconnected.'));
		}

		// Get the WebSocket URI for the session. This will throw an error if
		// the URI cannot be determined.
		const wsUri = await this.getWebsocketUri();

		return new Promise((resolve, reject) => {
			// Ensure websocket is closed if it's open
			if (this._socket) {
				this._socket.close();
			}

			this.log(`Connecting to session WebSocket via ${wsUri}`, vscode.LogLevel.Info);

			// Get the bearer token from the API for WebSocket authentication
			// @ts-ignore
			const headers = this._api.configuration?.baseOptions?.headers;
			if (!headers) {
				this.log(`Warning: No Bearer token found for WebSocket authentication`, vscode.LogLevel.Warning);
			}

			this._socket = new SocketSession(wsUri, this.metadata.sessionId, this._consoleChannel, headers);
			this._disposables.push(this._socket);

			// Handle websocket events
			this._socket.ws.onopen = () => {
				this.log(`Connected to websocket ${wsUri}.`, vscode.LogLevel.Debug);
				// Open the connected barrier so that we can start sending messages
				this._connected.open();
				resolve();
			};

			this._socket.ws.onerror = (err: any) => {
				this.log(`Websocket error: ${JSON.stringify(err)}`, vscode.LogLevel.Error);
				if (this._connected.isOpen()) {
					// If the error happened after the connection was established,
					// something bad happened. Close the connected barrier and
					// show an error.
					this._connected = new Barrier();
					vscode.window.showErrorMessage(`Error connecting to ${this.dynState.sessionName} (${this.metadata.sessionId}): ${JSON.stringify(err)}`);
				} else {
					// The connection never established; reject the promise and
					// let the caller handle it.
					reject(err);
				}
			};

			this._socket.ws.onclose = (evt: any) => {
				this.log(`Websocket closed with kernel in status ${this._runtimeState}: ${JSON.stringify(evt)}`, vscode.LogLevel.Info);

				// Only fire the disconnected event if we are eligible to
				// reconnect
				if (this._canConnect) {
					const disconnectEvent: DisconnectedEvent = {
						reason: this._runtimeState === positron.RuntimeState.Exited ?
							DisconnectReason.Exit : DisconnectReason.Unknown,
						state: this._runtimeState,
					};
					this.disconnected.fire(disconnectEvent);
				}

				// When the socket is closed, reset the connected barrier and
				// clear the websocket instance.
				this._connected = new Barrier();
				this._socket = undefined;
			};

			// Main handler for incoming messages
			this._socket.ws.onmessage = (msg: any) => {
				try {
					const data = JSON.parse(msg.data.toString());
					this.handleMessage(data);
				} catch (err) {
					this.log(`Could not parse message: ${err}`, vscode.LogLevel.Error);
				}
			};
		});
	}

	/**
	 * Interrupt a running kernel.
	 *
	 * @returns A promise that resolves when the kernel interrupt request has
	 * been sent. Note that the kernel may not be interrupted immediately.
	 */
	async interrupt(): Promise<void> {
		// Mark the session as interrupting
		this.onStateChange(positron.RuntimeState.Interrupting, 'interrupting kernel');

		// Clear current input request if any
		this._activeBackendRequestHeader = null;

		try {
			await this._api.interruptSession(this.metadata.sessionId);
		} catch (err) {
			if (isAxiosError(err)) {
				throw new Error(summarizeAxiosError(err));
			}
			throw err;
		}
	}

	getDynState(): Thenable<positron.LanguageRuntimeDynState> {
		return Promise.resolve(this.dynState);
	}

	/**
	 * Performs a restart of the kernel. Kallichore handles the mechanics of
	 * stopping the process and starting a new one; we just need to listen for
	 * the events and update our state.
	 */
	async restart(workingDirectory?: string): Promise<void> {
		// Remember that we're restarting so that when the exit event arrives,
		// we can label it as such
		this._exitReason = positron.RuntimeExitReason.Restart;

		// Perform the restart
		this._restarting = true;
		try {
			// Create the restart request
			const restart: RestartSession = {
				// Supply working directory if provided
				working_directory: workingDirectory,

				// Build the set of environment variables to pass to the kernel.
				// This is done on every restart so that changes to extension
				// environment contributions can be respected.
				env: await this.buildEnvVarActions(true),
			};
			await this._api.restartSession(this.metadata.sessionId, restart);

			// Mark ready after a successful restart
			this.markReady('restart complete');
		} catch (err) {
			if (isAxiosError(err)) {
				throw new Error(summarizeAxiosError(err));
			} else {
				throw err;
			}
		}
	}

	/**
	 * Performs a shutdown of the kernel.
	 *
	 * @param exitReason The reason for the shutdown
	 */
	async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		this._exitReason = exitReason;
		const restarting = exitReason === positron.RuntimeExitReason.Restart;
		const shutdownRequest = new ShutdownRequest(restarting);
		await this.sendRequest(shutdownRequest);
	}

	/**
	 * Forces the kernel to quit immediately.
	 */
	async forceQuit(): Promise<void> {
		try {
			this._exitReason = positron.RuntimeExitReason.ForcedQuit;
			await this._api.killSession(this.metadata.sessionId);
		} catch (err) {
			this._exitReason = positron.RuntimeExitReason.Unknown;
			throw err;
		}
	}

	/**
	 * Shows the profile output for this kernel, if any.
	 */
	async showProfile?(): Promise<void> {
		this._profileChannel?.show();
	}

	/**
	 * Clean up the session.
	 */
	dispose() {
		// Close the websocket if it's open
		if (this._socket) {
			this._socket.close();
		}

		// Close the log streamer, the websocket, and any other disposables
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
	}

	/**
	 * Disconnect the session
	 */
	public disconnect() {
		this._socket?.ws.close();
	}

	/**
	 * Main entry point for handling messages delivered over the websocket from
	 * the Kallichore server.
	 *
	 * @param data The message payload
	 */
	handleMessage(data: any) {
		if (!data.kind) {
			this.log(`Kallichore session ${this.metadata.sessionId} message has no kind: ${JSON.stringify(data)}`, vscode.LogLevel.Warning);
			return;
		}
		switch (data.kind) {
			case 'kernel':
				this.handleKernelMessage(data);
				break;
			case 'jupyter':
				this.handleJupyterMessage(data);
				break;
		}
	}

	/**
	 * Handles kernel-level messages sent from the Kallichore server.
	 *
	 * @param data The message payload
	 */
	handleKernelMessage(data: any) {
		this.log(`<<< RECV [kernel]: ${JSON.stringify(data)}`, vscode.LogLevel.Debug);
		if (data.hasOwnProperty('status')) {
			// Extract the new status
			const status = data.status.status;

			// Check to see if the status is a valid runtime state
			if (Object.values(positron.RuntimeState).includes(status)) {
				// The 'starting' state typically follows 'uninitialized' (new
				// session) or 'exited' (a restart). We can ignore the message
				// in other cases as we've already broadcasted the state change
				// to the client.
				if (status === positron.RuntimeState.Starting &&
					this._runtimeState !== positron.RuntimeState.Uninitialized &&
					this._runtimeState !== positron.RuntimeState.Exited) {
					this.log(`Ignoring 'starting' state message; already in state '${this._runtimeState}'`, vscode.LogLevel.Trace);
					return;
				}
				// Same deal for 'ready' state; if we've already broadcasted the
				// 'idle' state, ignore it.
				if (status === positron.RuntimeState.Ready &&
					this._runtimeState === positron.RuntimeState.Idle) {
					this.log(`Ignoring 'ready' state message; already in state '${this._runtimeState}'`, vscode.LogLevel.Trace);
					return;
				}
				this.onStateChange(status, data.status.reason);
			} else {
				this.log(`Unknown state: ${status}`);
			}
		} else if (data.hasOwnProperty('output')) {
			const output = data as KernelOutputMessage;
			this._kernelChannel.append(output.output[1]);
		} else if (data.hasOwnProperty('clientDisconnected')) {
			// Log the disconnection and close the socket
			this._kernelChannel.append(`Client disconnected: ${data.clientDisconnected}`);
			this.disconnect();

			// Treat the runtime as exited
			const disconnectEvent: DisconnectedEvent = {
				reason: DisconnectReason.Transferred,
				state: this._runtimeState,
			};
			this.disconnected.fire(disconnectEvent);
			this.onStateChange(positron.RuntimeState.Exited, data.clientDisconnected);

			const exitEvent: positron.LanguageRuntimeExit = {
				exit_code: 0,
				reason: positron.RuntimeExitReason.Transferred,
				runtime_name: this.runtimeMetadata.runtimeName,
				session_name: this.dynState.sessionName,
				message: ''
			};
			this._exit.fire(exitEvent);

			// Additional guard to ensure we don't try to reconnect
			this._canConnect = false;
		} else if (data.hasOwnProperty('exited')) {
			this.onExited(data.exited);
		}
	}

	updateSessionName(sessionName: string): void {
		// Update the dynamic state with the new values
		this.dynState.sessionName = sessionName;
	}

	/**
	 * Gets the current runtime state of the kernel.
	 */
	get runtimeState(): positron.RuntimeState {
		return this._runtimeState;
	}

	/**
	 * Gets the runtime information for the kernel, if available.
	 */
	get runtimeInfo(): positron.LanguageRuntimeInfo | undefined {
		return this._runtimeInfo;
	}

	/**
	 * Processs and emit a state change.
	 *
	 * @param newState The new kernel state
	 * @param reason The reason for the state change
	 */
	private onStateChange(newState: positron.RuntimeState, reason: string) {
		// If the kernel is ready, open the ready barrier
		if (newState === positron.RuntimeState.Ready) {
			this.log(`Kernel is ready.`);
		}
		this.log(`State: ${this._runtimeState} => ${newState} (${reason})`, vscode.LogLevel.Debug);
		if (newState === positron.RuntimeState.Offline) {
			// Close the connected barrier if the kernel is offline
			this._connected = new Barrier();
		}
		if (this._runtimeState === positron.RuntimeState.Offline &&
			newState !== positron.RuntimeState.Exited &&
			newState !== positron.RuntimeState.Offline) {
			// The kernel was offline but is back online; open the connected
			// barrier
			this.log(`The kernel is back online.`, vscode.LogLevel.Info);
			this._connected.open();
		}
		if (newState === positron.RuntimeState.Starting) {
			if (this._restarting) {
				this.log(`The kernel has started up after a restart.`, vscode.LogLevel.Info);
				this._restarting = false;
			}
		}

		// Fire an event if the state has changed.
		if (this._runtimeState !== newState) {
			this._runtimeState = newState;
			this._state.fire(newState);
		}
	}

	/**
	 * Marks the kernel as exited.
	 *
	 * @param exitCode The exit code
	 * @param reason The reason for the exit
	 */
	markExited(exitCode: number, reason: positron.RuntimeExitReason) {
		this._exitReason = reason;
		this.onStateChange(positron.RuntimeState.Exited, 'kernel exited with code ' + exitCode);
		this.onExited(exitCode);
	}

	/**
	 * Marks the kernel as offline.
	 *
	 * @param reason The reason for the kernel going offline
	 */
	markOffline(reason: string) {
		this.onStateChange(positron.RuntimeState.Offline, reason);
	}

	private onExited(exitCode: number) {
		if (this._restarting) {
			// If we're restarting, wait for the kernel to start up again
			this.log(`Kernel exited with code ${exitCode}; waiting for restart to finish.`, vscode.LogLevel.Info);
		} else {
			// If we aren't going to be starting up again, clean up the session
			// websocket
			this.log(`Kernel exited with code ${exitCode}; cleaning up.`, vscode.LogLevel.Info);
			this._socket?.close();
			this._socket = undefined;
			this._connected = new Barrier();
		}

		// All clients are now closed
		this._clients.clear();

		// Close all raw comms
		for (const [comm, tx] of this._comms.values()) {
			// Don't dispose of comm, this resource is owned by caller of `createComm()`.
			comm.close();
			tx.dispose();
		}
		this._comms.clear();

		// Clear any starting comms
		this._startingComms.forEach((promise) => {
			promise.reject(new Error('Kernel exited'));
		});
		this._startingComms.clear();

		// Clear any pending requests
		this._pendingRequests.clear();
		this._pendingUiCommRequests.forEach((req) => {
			req.promise.reject(new Error('Kernel exited'));
		});
		this._pendingUiCommRequests = [];

		// If we don't know the exit reason and there's a nonzero exit code,
		// consider this exit to be due to an error.
		if (this._exitReason === positron.RuntimeExitReason.Unknown && exitCode !== 0) {
			this._exitReason = positron.RuntimeExitReason.Error;
		}

		// Create and fire the exit event.
		const event: positron.LanguageRuntimeExit = {
			runtime_name: this.runtimeMetadata.runtimeName,
			session_name: this.dynState.sessionName,
			exit_code: exitCode,
			reason: this._exitReason,
			message: ''
		};
		this._exit.fire(event);

		// We have now consumed the exit reason; restore it to its default
		this._exitReason = positron.RuntimeExitReason.Unknown;
	}

	/**
	 * Gets the kernel's information, using the `kernel_info` request.
	 *
	 * @returns The kernel's information
	 */
	async getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		// Send the info request to the kernel; note that this waits for the
		// kernel to be connected.
		const request = new KernelInfoRequest();
		const reply = await this.sendRequest(request);
		return this.runtimeInfoFromKernelInfo(reply);
	}

	/**
	 * Translates a kernel info reply into a runtime info object and updates the
	 * dynamic state.
	 *
	 * @param reply The Jupyter kernel info reply
	 * @returns The Positron runtime info object
	 */
	private runtimeInfoFromKernelInfo(reply: KernelInfoReply) {
		// Read the input and continuation prompts
		const input_prompt = reply.language_info.positron?.input_prompt;
		const continuation_prompt = reply.language_info.positron?.continuation_prompt;

		// Populate the initial dynamic state with the input and continuation
		// prompts
		if (input_prompt && !this.dynState.inputPrompt) {
			this.dynState.inputPrompt = input_prompt;
		}
		if (continuation_prompt && !this.dynState.continuationPrompt) {
			this.dynState.continuationPrompt = continuation_prompt;
		}

		// Translate the kernel info into a runtime info object
		this._runtimeInfo = {
			banner: reply.banner,
			implementation_version: reply.implementation_version,
			language_version: reply.language_info.version,
			supported_features: reply.supported_features,
			input_prompt,
			continuation_prompt,
		};

		return this._runtimeInfo;
	}

	/**
	 * Main entry point for handling Jupyter messages delivered over the
	 * websocket from the Kallichore server.
	 *
	 * @param data The message payload
	 */
	async handleJupyterMessage(data: any) {
		// Deserialize the message buffers from base64, if any
		if (data.buffers?.length > 0) {
			data.buffers = data.buffers.map((b: string) => {
				return Buffer.from(b, 'base64');
			});
		}

		// Cast the data to a Jupyter message
		const msg = data as JupyterMessage;

		// Log the message
		this.log(`<<< RECV ${msg.header.msg_type} [${msg.channel}]: ${JSON.stringify(msg.content)}`, vscode.LogLevel.Debug);

		// Check to see if the message is a reply to a request; if it is,
		// resolve the associated promise and remove it from the pending
		// requests map
		if (msg.parent_header && msg.parent_header.msg_id) {
			const request = this._pendingRequests.get(msg.parent_header.msg_id);
			if (request) {
				if (request.replyType === msg.header.msg_type) {
					request.resolve(msg.content);
					this._pendingRequests.delete(msg.parent_header.msg_id);

					// If this is a reply for an unmanaged comm, return early.
					// The comm socket gets the response via the now resolved request
					// promise.
					if (msg.header.msg_type === 'comm_msg') {
						const commMsg = msg.content as JupyterCommMsg;
						if (this._comms.has(commMsg.comm_id)) {
							return;
						}
					}
				}
			}
		}

		// Special handling for stdin messages, which have reversed control flow
		if (msg.channel === JupyterChannel.Stdin) {
			switch (msg.header.msg_type) {
				// If this is an input request, save the header so we can can
				// line it up with the client's response.
				case JupyterMessageType.InputRequest:
					this._activeBackendRequestHeader = msg.header;
					break;
				case JupyterMessageType.RpcRequest: {
					try {
						await this.onCommRequest(msg);
						this.log(`Handled comm request: ${JSON.stringify(msg.content)}`, vscode.LogLevel.Debug);
					} catch (err) {
						this.log(`Failed to handle comm request: ${JSON.stringify(err)}`, vscode.LogLevel.Error);
					}
					break;
				}
			}
		}

		// Handle comms that are not managed by Positron first
		switch (msg.header.msg_type) {
			case 'comm_close': {
				const closeMsg = msg.content as JupyterCommClose;
				const commHandle = this._comms.get(closeMsg.comm_id);

				if (commHandle) {
					// Delete first, this prevents the channel disposable from sending a
					// `comm_close` back
					this._comms.delete(closeMsg.comm_id);

					const [comm, _] = commHandle;
					comm.close();
					return;
				}

				break;
			}

			case 'comm_msg': {
				const commMsg = msg.content as JupyterCommMsg;
				const commHandle = this._comms.get(commMsg.comm_id);

				if (commHandle) {
					const [_, tx] = commHandle;
					const rpcMsg = commMsg.data as CommRpcMessage;

					if (rpcMsg.id) {
						tx.send(new CommBackendRequest(this, commMsg.comm_id, rpcMsg));
					} else {
						tx.send({ kind: 'notification', method: rpcMsg.method, params: rpcMsg.params });
					}

					return;
				}

				break;
			}
		}

		// TODO: Make LSP comms unmanaged and remove this branch
		if (msg.header.msg_type === 'comm_msg') {
			const commMsg = msg.content as JupyterCommMsg;
			// If this is a `server_started` message, resolve the promise that
			// was created when the comm was started.
			if (commMsg.data.msg_type === 'server_started') {
				// TODO: Could be more type-safe
				const serverStarted = commMsg.data.content as any;
				const startingPromise = this._startingComms.get(commMsg.comm_id);
				if (startingPromise) {
					startingPromise.resolve(serverStarted.port);
					this._startingComms.delete(commMsg.comm_id);
				}
			}
		}

		// Translate the Jupyter message to a LanguageRuntimeMessage and emit it
		this._messages.emitJupyter(msg);
	}

	/**
	 * Part of a reverse request from the UI comm. These requests are fulfilled
	 * by Positron and the results sent back to the kernel.
	 *
	 * @param msg The message payload
	 */
	async onCommRequest(msg: JupyterMessage): Promise<void> {
		const request = msg.content as JupyterCommRequest;

		// Get the response from Positron
		const response = await positron.methods.call(request.method, request.params);

		// Send the response back to the kernel
		const reply = new RpcReplyCommand(msg.header, response);
		return this.sendCommand(reply);
	}

	/**
	 * Sends an RPC request to the kernel and waits for a response.
	 *
	 * @param request The request to send
	 * @returns The response from the kernel
	 */
	async sendRequest<T>(request: JupyterRequest<any, T>): Promise<T> {
		// Ensure we're connected before sending the request; if requests are
		// sent before the connection is established, they'll fail
		await this._connected.wait();

		// Add the request to the pending requests map so we can match up the
		// reply when it arrives
		this._pendingRequests.set(request.msgId, request);

		// Send the request over the websocket
		return request.sendRpc(this._socket!);
	}

	/**
	 * Send a command to the kernel. Does not wait for a response.
	 *
	 * @param command The command to send
	 */
	async sendCommand<T>(command: JupyterCommand<T>): Promise<void> {
		// Ensure we're connected before sending the command
		await this._connected.wait();

		// Send the command over the websocket
		return command.sendCommand(this._socket!);
	}

	/**
	 * Begins streaming a log file to the kernel channel.
	 *
	 * @param logFile The path to the log file to stream
	 */
	private async streamLogFile(logFile: string) {
		const logStreamer = new LogStreamer(this._kernelChannel, logFile, this.runtimeMetadata.languageName);
		this._kernelChannel.appendLine(`Streaming kernel log file: ${logFile}`);
		this._disposables.push(logStreamer);
		this._kernelLogFile = logFile;
		return logStreamer.watch();
	}

	/**
	 * Begins streaming a profile file to the kernel channel.
	 *
	 * @param profileFilePath The path to the profile file to stream
	 */
	private async streamProfileFile(profileFilePath: string) {

		this._profileChannel = positron.window.createRawLogOutputChannel(
			this.metadata.notebookUri ?
				`Notebook: Profiler ${path.basename(this.metadata.notebookUri.path)} (${this.runtimeMetadata.runtimeName})` :
				`Positron ${this.runtimeMetadata.languageName} Profiler`);

		this.log('Streaming profile file: ' + profileFilePath, vscode.LogLevel.Debug);

		const profileStreamer = new LogStreamer(this._profileChannel, profileFilePath);
		this._disposables.push(profileStreamer);

		await profileStreamer.watch();
	}

	/**
	 * Emits a message to the the log channel
	 *
	 * @param msg The message to log
	 */
	public log(msg: string, logLevel?: vscode.LogLevel) {
		// Ensure message isn't over the maximum length
		if (msg.length > 2048) {
			msg = msg.substring(0, 2048) + '... (truncated)';
		}

		switch (logLevel) {
			case vscode.LogLevel.Error:
				this._consoleChannel.error(msg);
				break;
			case vscode.LogLevel.Warning:
				this._consoleChannel.warn(msg);
				break;
			case vscode.LogLevel.Info:
				this._consoleChannel.info(msg);
				break;
			case vscode.LogLevel.Debug:
				this._consoleChannel.debug(msg);
				break;
			case vscode.LogLevel.Trace:
				this._consoleChannel.trace(msg);
				break;
			default:
				this._consoleChannel.appendLine(msg);
		}
	}

	/**
	 * Sends any pending messages to the UI comm.
	 *
	 * @param uiCommId The ID of the UI comm to send the messages to
	 */
	private async sendPendingUiCommRequests(uiCommId: string) {
		// No work to do if there are no pending requests
		if (this._pendingUiCommRequests.length === 0) {
			return;
		}

		// Move the pending requests to a local variable so we can clear the
		// pending list and send the requests without worrying about reentrancy.
		const pendingRequests = this._pendingUiCommRequests;
		this._pendingUiCommRequests = [];

		// Wait for the kernel to be idle before sending any pending UI comm
		// requests.
		await this.waitForIdle();

		const count = pendingRequests.length;
		for (let i = 0; i < pendingRequests.length; i++) {
			const req = pendingRequests[i];
			this.log(`Sending queued UI comm request '${req.method}' (${i + 1} of ${count})`, vscode.LogLevel.Debug);
			try {
				await this.performUiCommRequest(req, uiCommId);
			} catch (err) {
				this.log(`Failed to perform queued request '${req.method}': ${err}`, vscode.LogLevel.Error);
			}
		}
	}
}
