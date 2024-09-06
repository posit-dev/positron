/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import fs = require('fs');
import { JupyterKernelSpec, JupyterSession, JupyterKernel } from './jupyter-adapter.d';
import { error } from 'console';

export class ReticulateRuntimeManager implements positron.LanguageRuntimeManager {

	_session: positron.LanguageRuntimeSession | undefined = undefined;

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
	}

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		console.log('Discovering reticulate runtimes');
		return reticulateRuntimesDiscoverer();
	}

	async createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		this._session = await ReticulateRuntimeSession.create(runtimeMetadata, sessionMetadata);
		return this._session;
	}

	async restoreSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		this._session = await ReticulateRuntimeSession.restore(runtimeMetadata, sessionMetadata);
		return this._session;
	}
}

enum ReticulateRuntimeSessionType {
	Create,
	Restore
}

class ReticulateRuntimeSession implements positron.LanguageRuntimeSession {

	private kernel: JupyterKernel | undefined;
	private pythonSession: positron.LanguageRuntimeSession;

	// To create a reticulate runtime session we need to first create a python
	// runtime session using the exported interface from the positron-python
	// extension.

	// The PythonRuntimeSession object in the positron-pyuthon extensions, is created
	// by passing 'runtimeMetadata', 'sessionMetadata' and something called 'kernelSpec'
	// that's further passed to the JupyterAdapter extension in order to actually initialize
	// the session.

	// ReticulateRuntimeSession are only different from Python runtime sessions in the
	// way the kernel spec is provided. In general, the kernel spec contains a runtime
	// path and some arguments that are used start the kernel process. (The kernel is started
	// by the Jupyter Adapter in a vscode terminal). In the reticulate case, the kernel isn't
	// started that way. Instead, we need to call into the R console to start the python jupyter
	// kernel (that's actually running in the same process as R), and only them, ask JupyterAdapter
	// to connect to that kernel.
	static async create(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
	): Promise<ReticulateRuntimeSession> {
		const rSession = await getRSession();
		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(rSession, runtimeMetadata);

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
		console.log(`Runtime metadata ${runtimeMetadata.runtimeId}:`, runtimeMetadata.extraRuntimeData);
		const rSession = await getRSession();
		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(rSession, runtimeMetadata);
		return new ReticulateRuntimeSession(
			rSession,
			metadata,
			sessionMetadata,
			ReticulateRuntimeSessionType.Restore
		);
	}

	static async fixInterpreterPath(
		rSession: positron.LanguageRuntimeSession,
		runtimeMetadata: positron.LanguageRuntimeMetadata
	): Promise<positron.LanguageRuntimeMetadata> {
		// Try to find the path of the reticulate interpreter that's going to be
		// executed.
		let interpreterPath = '';
		if (rSession.callMethod) {
			interpreterPath = await rSession.callMethod('reticulate_interpreter_path') as string;
		}
		if (interpreterPath === '') {
			throw new Error(`No path found for python.`);
		}

		const output = runtimeMetadata;
		output.runtimePath = interpreterPath;
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
				'startKernel': (session, kernel) => this.startKernel(session, kernel),
			};
		}

		console.log('Creating python session with kernelSpec:', kernelSpec);

		const api = vscode.extensions.getExtension('ms-python.python')?.exports;
		this.pythonSession = api.positron.createPythonRuntimeSession(
			runtimeMetadata,
			sessionMetadata,
			kernelSpec
		);

		this.onDidReceiveRuntimeMessage = this.pythonSession.onDidReceiveRuntimeMessage;
		this.onDidChangeRuntimeState = this.pythonSession.onDidChangeRuntimeState;
		this.onDidEndSession = this.pythonSession.onDidEndSession;
	}

	// A function that sstarts a kernel and then connects to it.
	async startKernel(session: JupyterSession, kernel: JupyterKernel) {
		kernel.log('Starting the reticulate session!');

		// Store a reference to the kernel, so the session can log, reconnect, etc.
		this.kernel = kernel;

		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;
		const profileFile = session.state.profileFile;
		const logLevel = 'debug';

		const kernelPath = `${__dirname}/../../positron-python/python_files/positron/positron_language_server.py`;
		const code = `reticulate:::py_run_file_on_thread(
file = "${kernelPath}",
	args = c(
		"-f", "${connnectionFile}",
		"--logfile", "${logFile}",
		"--loglevel", "${logLevel}",
		"--session-mode", "console"
	)
)`;

		if (!this.rSession) {
			kernel.log('No R session :(');
			throw new Error('No R session to attach the reticulate kernel');
		}

		this.rSession.execute(
			code,
			'start-reticulate',
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Stop
		);

		try {
			await kernel.connectToSession(session);
		} catch (err: any) {
			kernel.log('Failed starting session');
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
		this.pythonSession.shutdown(positron.RuntimeExitReason.Restart);
		await this.rSession.restart();
		const rSession = await getRSession();
		console.log('Executing command to start the new reticulate session!');
		rSession.execute(
			'reticulate::repl_python()',
			'start-reticulate',
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue
		);
		return;
	}

	public async shutdown() {
		console.log('Shutting down the reticulate kernel');
		await this.pythonSession.shutdown(positron.RuntimeExitReason.Shutdown);
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
	const maxRetries = 5;
	for (let i = 0; i < maxRetries; i++) {
		try {
			return await getRSession_();
		}
		catch (err) {
			console.log(`Could not find an R session. Retrying (${i}/${maxRetries}): ${err}`);
		}
	}
	throw new Error('Could not find initialize an R session to launch reticulate.');
}

async function getRSession_(): Promise<positron.LanguageRuntimeSession> {
	let session = await positron.runtime.getForegroundSession();
	if (!session || session.runtimeMetadata.languageId !== 'r') {
		const runtime = await positron.runtime.getPreferredRuntime('r');
		await positron.runtime.selectLanguageRuntime(runtime.runtimeId);
		session = await positron.runtime.getForegroundSession();
	}

	if (!session) {
		throw new Error(`No available R session to execute reticulate`);
	}

	return session;
}

async function* reticulateRuntimesDiscoverer() {
	const runtimeMetadata = new ReticulateRuntimeMetadata();
	yield runtimeMetadata;
}

class ReticulateRuntimeMetadata implements positron.LanguageRuntimeMetadata {
	extraRuntimeData: any = {
		pythonEnvironmentId: 'reticulate',
		//pythonPath: 'reticulate'
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
	constructor(readonly manager: ReticulateRuntimeManager) { }

	async registerClient(client: positron.RuntimeClientInstance) {
		if (this._client) {
			this._client.dispose();
		}
		this._client = client;

		await this.manager.discoverRuntimes();
		await positron.runtime.selectLanguageRuntime('reticulate');

		this.manager._session?.onDidEndSession(() => {
			console.log('Session ended, disposing client');
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
				console.log('Reticulate state:', state);
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
	console.log('Activating Reticulate extension');
	CONTEXT = context;

	const manager = new ReticulateRuntimeManager(context);
	context.subscriptions.push(positron.runtime.registerLanguageRuntimeManager(manager));

	const reticulateProvider = new ReticulateProvider(manager);

	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.reticulate',
			callback: (client, params: any) => {
				reticulateProvider.registerClient(client);
				return true;
			}
		}));

	context.subscriptions.push(reticulateProvider);

	console.log('Reticulate extension activated');

	return manager;
}

