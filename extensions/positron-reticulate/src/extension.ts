/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import fs = require('fs');
import { JupyterKernelSpec, JupyterSession } from './jupyter-adapter.d';

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
		this._session = await createReticulateSession(runtimeMetadata, sessionMetadata);
		this._session.onDidEndSession((e) => {
			this._session = undefined;
		});
		return this._session;
	}

	async restoreSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		this._session = await restoreReticulateSession(runtimeMetadata, sessionMetadata);
		this._session.onDidEndSession((e) => {
			this._session = undefined;
		});
		return this._session;
	}
}

async function restoreReticulateSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata) {
	const api = vscode.extensions.getExtension('ms-python.python')?.exports;
	// kernelSpec = undefined means that we are reconnecting to a running session
	const pythonSession: positron.LanguageRuntimeSession = new api.positron(runtimeMetadata, sessionMetadata, api.serviceContainer, undefined);
	return pythonSession;
}

async function createReticulateSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata) {

	const r_session = await getRSession();

	const startKernel = async (session: JupyterSession, self: any) => {

		self.log('Ready to start reticulate session');

		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;
		const profileFile = session.state.profileFile;
		const logLevel = 'debug';

		const kernelPath = `${__dirname}/../../positron-python/python_files/positron/positron_language_server.py`;

		const code = `
reticulate::import("rpytools.run")$\`_launch_lsp_server_on_thread\`(
	"${kernelPath}",
	reticulate::tuple(
		'-f', "${connnectionFile}",
		'--logfile', "${logFile}",
		'--loglevel', '${logLevel}',
		'--session-mode', 'console'
	)
)
`;

		// Execute the piece of code that starts reticulate background session.
		r_session.execute(
			code,
			'start-reticulate',
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Stop
		);

		try {
			await self.connectToSession(session);
		} catch (err: any) {
			self.log('Failed starting session');
			throw err;
		}
	};

	const kernelSpec: JupyterKernelSpec = {
		'argv': [],
		'display_name': "Reticulate1 Python Session", // eslint-disable-line
		'language': 'Python',
		'env': {},
		'startKernel': startKernel,
	};

	console.log('[Reticulate] We will call R to check for a reticulate interpreter');
	let path = '';

	if (r_session.callMethod) {
		path = await r_session.callMethod('reticulate_interpreter_path') as string;
	}

	if (path === '') {
		throw new Error(`No path found for python.`);
	}

	console.log('[Reticulate] Found interpreter path: ', path);

	if (path !== '') {
		runtimeMetadata.runtimePath = path;
		runtimeMetadata.extraRuntimeData.pythonPath = path;
	}

	const api = vscode.extensions.getExtension('ms-python.python')?.exports;
	const pythonSession: positron.LanguageRuntimeSession = new api.positron(runtimeMetadata, sessionMetadata, api.serviceContainer, kernelSpec);

	return pythonSession;
}

async function getRSession(): Promise<positron.LanguageRuntimeSession> {
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
		//positron.runtime.selectLanguageRuntime('reticulate');
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

