/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import fs = require('fs');
import { JupyterKernelSpec, JupyterSession, JupyterKernel } from './jupyter-adapter.d';

export class ReticulateRuntimeManager implements positron.LanguageRuntimeManager {

	// The reticulate runtime manager can only have a single reticulate runtime session
	// that's currently running. This `_session` field contains this session.
	_session?: positron.LanguageRuntimeSession;

	// This field contains the reticulate runtime metadata. It's only set once the
	// runtime has been registered.
	_metadata?: positron.LanguageRuntimeMetadata;

	// This is returned by positron when we register a listener to the onDidDiscoverRuntime
	// event. We wait until R runtimes are registered to register the reticulate runtime,
	// but once the reticulate runtime is registered, we need to dispose of this.
	_registrationHook?: vscode.Disposable;

	// Positron listens to this event and will update its UI once it's fired with
	// a new runtime.
	onDidDiscoverRuntime?: vscode.Event<positron.LanguageRuntimeMetadata>;
	onDidDiscoverRuntimeEmmiter?: vscode.EventEmitter<positron.LanguageRuntimeMetadata>;

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
		this.onDidDiscoverRuntimeEmmiter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>;
		this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmmiter.event;

		vscode.workspace.onDidChangeConfiguration((event) => {
			if (this._metadata) {
				return; // If the runtime is already registered, don't do anything
			}
			if (event.affectsConfiguration('positron.reticulate.enabled') && this.featureEnabled()) {
				this.maybeRegisterReticulateRuntime();
			}
		});

		if (this.featureEnabled()) {
			this.maybeRegisterReticulateRuntime();
		}
	}

	featureEnabled(): boolean | undefined {
		// If it's disabled, don't do any registration
		const config = vscode.workspace.getConfiguration('positron.reticulate');
		return config.get<boolean>('enabled');
	}

	async maybeRegisterReticulateRuntime() {

		if (this._metadata) {
			return; // No-op if session is already registered.
		}

		// Get a fixed list of all current runtimes.
		const runtimes = await positron.runtime.getRegisteredRuntimes();

		// Hook that will register the reticulate runtime if an R
		// runtime is found.
		this._registrationHook = positron.runtime.onDidRegisterRuntime((metadata) => {
			if (!this._metadata && metadata.languageId === 'r') {
				this.registerReticulateRuntime();
			}
		});

		this._context.subscriptions.push(this._registrationHook);

		// Walk trough the list of runtimes looking for an R runtime,
		// if one exists we register the reticulate runtime.
		for (const runtime of runtimes) {
			if (!this._metadata && runtime.languageId === 'r') {
				this.registerReticulateRuntime();
				return;
			}
		}
	}

	registerReticulateRuntime() {
		this._metadata = new ReticulateRuntimeMetadata();
		this.onDidDiscoverRuntimeEmmiter?.fire(this._metadata);

		if (this._registrationHook) {
			this._registrationHook.dispose();
			this._registrationHook = undefined;
		}
	}

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		// We never discover a runtime directly. We'll always check if R is available
		// and then fire the onDidDiscoverRuntime event.
		return (async function* () { })();
	}

	async createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		try {
			this._session = await ReticulateRuntimeSession.create(runtimeMetadata, sessionMetadata);
			return this._session;
		} catch (err: any) {
			// When an error happens trying to create a session, we'll create a notification
			// to show the error to the user.
			// Initialization only requires a message.
			let error = err;
			if (!(err instanceof InitializationError)) {
				error = new InitializationError(err.message);
			}
			error.showAsNotification();
			throw err;
		}
	}

	async restoreSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		try {
			this._session = await ReticulateRuntimeSession.restore(runtimeMetadata, sessionMetadata);
			return this._session;
		} catch (err: any) {
			const error = err as InitializationError;
			error.showAsNotification();
			throw err;
		}
	}
}

enum ReticulateRuntimeSessionType {
	Create,
	Restore
}

class ReticulateConfig {
	python?: string;
	venv?: string;
	ipykernel?: boolean;
	error?: string;
}

class InitializationError extends Error {
	constructor(readonly message: string, readonly actions: Array<{
		title: string; execute: () => void;
	}> = []) {
		super(message);
	}

	showAsNotification() {
		const display_error = async () => {
			const selection = await vscode.window.showErrorMessage(vscode.l10n.t(
				'Failed to initialize the Reticulate Python session: {0}',
				this.message
			), ...this.actions);

			if (selection && selection.execute) {
				selection.execute();
			}
		};
		display_error();
	}
}

class ReticulateRuntimeSession implements positron.LanguageRuntimeSession {

	private kernel: JupyterKernel | undefined;
	private pythonSession: positron.LanguageRuntimeSession;

	// To create a reticulate runtime session we need to first create a python
	// runtime session using the exported interface from the positron-python
	// extension.

	// The PythonRuntimeSession object in the positron-python extensions, is created
	// by passing 'runtimeMetadata', 'sessionMetadata' and something called 'kernelSpec'
	// that's further passed to the JupyterAdapter extension in order to actually initialize
	// the session.

	// ReticulateRuntimeSession are only different from Python runtime sessions in the
	// way the kernel spec is provided. In general, the kernel spec contains a runtime
	// path and some arguments that are used start the kernel process. (The kernel is started
	// by the Jupyter Adapter in a vscode terminal). In the reticulate case, the kernel isn't
	// started that way. Instead, we need to call into the R console to start the python jupyter
	// kernel (that's actually running in the same process as R), and only then, ask JupyterAdapter
	// to connect to that kernel.
	static async create(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
	): Promise<ReticulateRuntimeSession> {
		const rSession = await getRSession();
		const config = await ReticulateRuntimeSession.checkRSession(rSession);
		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(runtimeMetadata, config.python);

		return new ReticulateRuntimeSession(
			rSession,
			metadata,
			sessionMetadata,
			ReticulateRuntimeSessionType.Create
		);
	}

	static async restore(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
	): Promise<ReticulateRuntimeSession> {
		const rSession = await getRSession();
		const config = await ReticulateRuntimeSession.checkRSession(rSession);
		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(runtimeMetadata, config.python);
		return new ReticulateRuntimeSession(
			rSession,
			metadata,
			sessionMetadata,
			ReticulateRuntimeSessionType.Restore
		);
	}

	static async checkRSession(rSession: positron.LanguageRuntimeSession): Promise<{ python: string }> {
		// Check that we have a minimum version of reticulate.
		if (!await rSession.callMethod?.('is_installed', 'reticulate', '1.39')) {
			// Offer to install reticulate
			const install_reticulate = await positron.window.showSimpleModalDialogPrompt(
				'Missing reticulate',
				'Reticulate >= 1.39 is required. Do you want to install reticulate?',
				'Yes',
				'No'
			);

			if (install_reticulate) {
				try {
					await rSession.callMethod?.('install_packages', 'reticulate');
				} catch (err: any) {
					throw new InitializationError(`Failed to install/update the reticulate package: ${err}`);
				}
			}

			// Make a new check for reticulate
			if (!await rSession.callMethod?.('is_installed', 'reticulate', '1.39')) {
				throw new InitializationError('Reticulate >= 1.39 is required');
			}
		}

		const config: ReticulateConfig = await rSession.callMethod?.('reticulate_check_prerequisites');

		// An error happened, raise it
		if (config.error) {
			throw new InitializationError(`Failed checking for a suitable Python: ${config.error}`);
		}

		// No error, but also no Python:
		if (!config.python) {
			throw new InitializationError(
				vscode.l10n.t('A Python installation is required to execute reticulate.'),
				[
					{
						title: 'reticulate::install_python()',
						execute: () => {
							positron.runtime.executeCode(
								'r',
								'reticulate::install_python() # This may take a few minutes',
								true,
								false
							);
						}
					},
					{
						title: vscode.l10n.t('Open Docs'),
						execute: () => {
							const docsUrl = 'https://rstudio.github.io/reticulate/articles/versions.html';
							vscode.env.openExternal(vscode.Uri.parse(docsUrl));
						}
					}
				]
			);
		}

		// Not a venv
		if (!config.venv) {
			// Reticulate strongly recommends a venv, so we gently inform the user that they
			// are not using a venv, and that they should.

			// TODO: what more can we say here? And what actions can we suggest the use to take?
			const informCreateVirtualEenv = async function () {
				const selection = await vscode.window.showInformationMessage(vscode.l10n.t(`
				Reticulate strongly recommends using a virtualenv.
				`,
					{
						title: 'reticulate::virtualenv_create()',
						execute: () => {
							positron.runtime.executeCode(
								'r',
								'reticulate::virtualenv_create("r-reticulate", packages = c("numpy", "ipykernel"))',
								true,
								false
							);
						}
					}
				));
			};
			// We don't need to await for that, just let they know what we recommend.
			informCreateVirtualEenv();
		}

		return { python: config.python };
	}

	static async fixInterpreterPath(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		interpreterPath: string
	): Promise<positron.LanguageRuntimeMetadata> {

		const output = runtimeMetadata;
		output.runtimePath = interpreterPath;

		// Uses the Positron Python extension API to query the environment id
		// given it's path.
		const api = vscode.extensions.getExtension('ms-python.python');
		if (!api) {
			throw new Error('Failed to find the Positron Python extension API.');
		}
		const env = await api.exports.environments.resolveEnvironment(interpreterPath);
		output.extraRuntimeData.pythonEnvironmentId = env.id;
		output.extraRuntimeData.pythonPath = interpreterPath;

		return output;
	}

	/** An object that emits language runtime events */
	public onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	/** An object that emits the current state of the runtime */
	public onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	/** An object that emits an event when the user's session ends and the runtime exits */
	public onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	constructor(
		readonly rSession: positron.LanguageRuntimeSession,
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		sessionType: ReticulateRuntimeSessionType,
	) {
		// When the kernelSpec is undefined, the PythonRuntimeSession
		// will perform a restore session.
		let kernelSpec: JupyterKernelSpec | undefined = undefined;
		if (sessionType === ReticulateRuntimeSessionType.Create) {
			kernelSpec = {
				'argv': [],
				'display_name': "Reticulate Python Session", // eslint-disable-line
				'language': 'Python',
				'env': {},
				'startKernel': async (session, kernel) => {
					try {
						await this.startKernel(session, kernel);
					} catch (err: any) {
						// Any error when trying to start kernel is caught and we send an error
						// notification.
						vscode.window.showErrorMessage(vscode.l10n.t(
							'Failed to initialize and connect to the Reticulate Python session: {0}',
							err.message
						));
						throw err;
					}
				},
			};
		}

		const api = vscode.extensions.getExtension('ms-python.python');
		if (!api) {
			throw new Error('Failed to find the Positron Python extension API.');
		}
		this.pythonSession = api.exports.positron.createPythonRuntimeSession(
			runtimeMetadata,
			sessionMetadata,
			kernelSpec
		);

		this.onDidReceiveRuntimeMessage = this.pythonSession.onDidReceiveRuntimeMessage;
		this.onDidChangeRuntimeState = this.pythonSession.onDidChangeRuntimeState;
		this.onDidEndSession = this.pythonSession.onDidEndSession;
	}

	// A function that starts a kernel and then connects to it.
	async startKernel(session: JupyterSession, kernel: JupyterKernel) {
		kernel.log('Starting the reticulate session!');

		// Store a reference to the kernel, so the session can log, reconnect, etc.
		this.kernel = kernel;

		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;
		const profileFile = session.state.profileFile;
		const logLevel = 'debug';

		const kernelPath = `${__dirname}/../../positron-python/python_files/positron/positron_language_server.py`;

		if (!this.rSession) {
			kernel.log('No R session :(');
			throw new Error('No R session to attach the Reticulate Python kernel');
		}

		if (!this.rSession.callMethod) {
			throw new Error('No `callMethod` method in the RSession. This is not expected.');
		}

		const init_err = await this.rSession.callMethod(
			'reticulate_start_kernel',
			kernelPath as string,
			connnectionFile as string,
			logFile as string,
			logLevel as string
		) as string;

		// An empty result means that the initialization went fine.
		if (init_err !== '') {
			throw new Error(`Reticulate initialization failed: ${init_err}`);
		}

		try {
			await kernel.connectToSession(session);
		} catch (err: any) {
			kernel.log('Failed connecting to the Reticulate Python session');
			throw err;
		}
	}

	/**
	 *  Forward properties to the pythonSession.
	 */

	public get metadata() {
		return this.pythonSession.metadata;
	}

	public get runtimeMetadata() {
		return this.pythonSession.runtimeMetadata;
	}

	public get dynState() {
		return this.pythonSession.dynState;
	}

	public execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior) {
		return this.pythonSession.execute(code, id, mode, errorBehavior);
	}

	public isCodeFragmentComplete(code: string) {
		return this.pythonSession.isCodeFragmentComplete(code);
	}

	public createClient(id: string, type: positron.RuntimeClientType, params: any, metadata?: any) {
		return this.pythonSession.createClient(id, type, params, metadata);
	}

	public listClients() {
		return this.pythonSession.listClients();
	}

	public removeClient(id: string) {
		return this.pythonSession.removeClient(id);
	}

	public sendClientMessage(client_id: string, message_id: string, message: any) {
		return this.pythonSession.sendClientMessage(client_id, message_id, message);
	}

	public replyToPrompt(id: string, reply: string) {
		return this.pythonSession.replyToPrompt(id, reply);
	}

	public start() {
		return this.pythonSession.start();
	}

	public interrupt() {
		return this.pythonSession.interrupt();
	}

	public async restart() {
		// Sending a restart to the python session will not work simply, because it's
		// tied to the R session.
		// We have to send a restart to the R session, and send a reticulate::repl_python()
		// command to it.
		const restart = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Restarting reticulate'),
			vscode.l10n.t('This is will also restart the parent R session. Are you sure you want to continue?'),
			vscode.l10n.t('Yes'),
			vscode.l10n.t('No')
		);

		if (!restart) {
			throw new Error('Restart cancelled.');
		}

		// The events below will make sure that things occur in the right order:
		// 1. shutdown the current reticulate session
		// 2. restart the attached R session
		// 3. start a new reticulate session.
		this.pythonSession.onDidEndSession((sess) => {
			this.rSession.restart();
		});

		const disposeListener = this.rSession.onDidChangeRuntimeState(async (e) => {
			if (e === positron.RuntimeState.Ready) {
				this.rSession.execute(
					'reticulate::repl_python()',
					'start-reticulate',
					positron.RuntimeCodeExecutionMode.Interactive,
					positron.RuntimeErrorBehavior.Continue
				);
				// This should only happen once, so we dispose of this event as soon
				// as we have started reticulate.
				disposeListener.dispose();
			}
		});

		await this.shutdown(positron.RuntimeExitReason.Shutdown);
		return;
	}

	public async shutdown(exitReason: positron.RuntimeExitReason) {
		await this.pythonSession.shutdown(exitReason);
		// Tell Positron that the kernel has exit. When launching IPykernel from a standalone
		// process, when the kernel exits, then all of it's threads, specially the IOPub thread
		// holding the ZeroMQ sockets will cease to exist, and thus Positron identifies that the
		// kernel has successfuly closed. However, since we launch positron from a different thread,
		// when the kernel exits, the thread exits, but all other dangling threads are still alive,
		// thus Positron never identifies that the kernel exited. We must then manually fire exit event.
		// We rely on an implementation detail of the jupyter adapter, that allows us to force the
		// kernels to disconnect.
		(this.pythonSession as any)._kernel._kernel._allSockets.forEach((socket: any) => socket.disconnect());
		return;
	}

	public forceQuit() {
		// Force quit will kill the process, which also kills the R process.
		return this.pythonSession.forceQuit();
	}

	public dispose() {
		return this.pythonSession.dispose();
	}
}

async function getRSession(): Promise<positron.LanguageRuntimeSession> {

	// Retry logic to start an R session.
	const maxRetries = 5;
	let session;
	let error;
	for (let i = 0; i < maxRetries; i++) {
		try {
			session = await getRSession_();
		}
		catch (err: any) {
			error = err; // Keep the last error so we can display it
			if (err.user_cancelled) {
				console.info(`User requested to cancel R initialization`);
				break;
			}
			console.warn(`Could not find an R session .Retrying(${i} / ${maxRetries}): ${err} `);
		}
	}

	if (!session) {
		throw new Error(`Could not initialize an R session to launch reticulate. ${error}`);
	}

	return session;
}

class RSessionError extends Error {
	constructor(readonly message: string, readonly user_cancelled: boolean = false) {
		super(message);
	}
}

async function getRSession_(): Promise<positron.LanguageRuntimeSession> {
	let session = await positron.runtime.getForegroundSession();

	if (session) {
		// Get foreground session will return a runtime session even if it has
		// already exitted. We check that it's still there before proceeding.
		// TODO: it would be nice to have an API to check for the session state.
		try {
			await session.callMethod?.('is_installed', 'reticulate', '1.39');
		} catch (err) {
			session = undefined;
		}
	}

	if (!session || session.runtimeMetadata.languageId !== 'r') {
		session = await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Starting R session for reticulate',
			cancellable: true
		}, async (progress, token) => {
			token.onCancellationRequested(() => {
				throw new RSessionError('User requested cancellation', true);
			});
			progress.report({ increment: 0, message: 'Looking for prefered runtime...' });
			const runtime = await positron.runtime.getPreferredRuntime('r');

			progress.report({ increment: 20, message: 'Starting R runtime...' });
			await positron.runtime.selectLanguageRuntime(runtime.runtimeId);

			progress.report({ increment: 70, message: 'Getting R session...' });
			session = await positron.runtime.getForegroundSession();

			return session;
		});
	}

	if (!session) {
		throw new RSessionError(`No available R session to execute reticulate`);
	}

	return session;
}

class ReticulateRuntimeMetadata implements positron.LanguageRuntimeMetadata {
	extraRuntimeData: any = {
		pythonEnvironmentId: 'reticulate',
	};
	base64EncodedIconSvg: string | undefined;
	constructor() {
		this.base64EncodedIconSvg = fs
			.readFileSync(
				path.join(CONTEXT.extensionPath, 'resources', 'branding', 'reticulate.svg'),
				{ encoding: 'base64' }
			);
	}
	runtimePath: string = 'Managed by the reticulate package';
	runtimeName: string = 'Python (reticulate)';
	languageId: string = 'python';
	languageName: string = 'Python';
	runtimeId: string = 'reticulate';
	runtimeShortName: string = 'Python (reticulate)';
	runtimeVersion: string = '1.0';
	runtimeSource: string = 'reticulate';
	languageVersion = '1.0';
	startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Immediate;
	sessionLocation: positron.LanguageRuntimeSessionLocation = positron.LanguageRuntimeSessionLocation.Workspace;
}

export class ReticulateProvider {
	_client: positron.RuntimeClientInstance | undefined = undefined;
	manager: ReticulateRuntimeManager;
	registrationHook: vscode.Disposable | undefined;

	constructor(readonly context: vscode.ExtensionContext) {
		this.manager = new ReticulateRuntimeManager(this.context);
		this.context.subscriptions.push(positron.runtime.registerLanguageRuntimeManager(this.manager));
	}

	async registerClient(client: positron.RuntimeClientInstance) {
		if (this._client) {
			this._client.dispose();
		}

		this._client = client;
		// We'll force the registration when the user calls `reticulate::repl_python()`
		// even if the flag is not enabled.
		await this.manager.maybeRegisterReticulateRuntime();
		await positron.runtime.selectLanguageRuntime('reticulate');

		this.manager._session?.onDidEndSession(() => {
			this._client?.dispose();
			this._client = undefined;
		});

		this._client.onDidSendEvent((e) => {
			const event = e.data as any;
			if (event.method === 'focus') {
				this.focusReticulateConsole();
			}
		});

		this._client.onDidChangeClientState(
			(state: positron.RuntimeClientState) => {
				if (state === positron.RuntimeClientState.Closed) {
					this._client = undefined;
				}
			}
		);
	}

	focusReticulateConsole() {
		// if this session is already active, this is a no-op that just
		// brings focus.
		positron.runtime.selectLanguageRuntime('reticulate');
		// Execute an empty code block to focus the console
		positron.runtime.executeCode('python', '', true, true);
	}

	dispose() {
		this._client?.dispose();
		this._client = undefined;
	}
}


let CONTEXT: vscode.ExtensionContext;

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	CONTEXT = context;
	const reticulateProvider = new ReticulateProvider(context);

	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.reticulate',
			callback: (client, params: any) => {
				reticulateProvider.registerClient(client);
				return true;
			}
		}));

	context.subscriptions.push(reticulateProvider);

	return reticulateProvider;
}

