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

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
	}

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		console.log('Discovering reticulate runtimes');
		return reticulateRuntimesDiscoverer();
	}

	createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {
		return createReticulateSession(runtimeMetadata, sessionMetadata);
	}

	restoreSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {
		return restoreReticulateSession(runtimeMetadata, sessionMetadata);
	}
}

async function restoreReticulateSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata) {
	const api = vscode.extensions.getExtension('ms-python.python')?.exports;
	// kernelSpec = undefined means that we are reconnecting to a running session
	const pythonSession = new api.positron(runtimeMetadata, sessionMetadata, api.serviceContainer, undefined);
	return pythonSession;
}

async function createReticulateSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata) {

	//session.execute('reticulate::repl_python()');
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

		// this is the piece of code that initializes IPython in the R session.
		positron.runtime.executeCode(
			'r',
			code,
			true,
			false
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

	const api = vscode.extensions.getExtension('ms-python.python')?.exports;
	const pythonSession = new api.positron(runtimeMetadata, sessionMetadata, api.serviceContainer, kernelSpec);
	return pythonSession;
}

async function* reticulateRuntimesDiscoverer() {

	const session = await positron.runtime.getForegroundSession();
	if (session && session.runtimeMetadata.languageId === 'r') {
		// If there's an R foreground session, we try to find the interpreter
		// reticulate would use by sending a command to it.
		console.log('[Reticulate] We will call R to check for a reticulate interpreter');
		let path = '';
		if (session.callMethod) {
			console.log('calling the R rpc');
			path = await session.callMethod('reticulate_interpreter_path') as string;
		}

		console.log('[Reticulate] Found interpreter path: ', path);

		if (path !== '') {
			const runtimeMetadata = new ReticulateRuntimeMetadata();
			runtimeMetadata.runtimePath = path;
			runtimeMetadata.extraRuntimeData.pythonPath = path;
			yield runtimeMetadata;
		}
	}
	console.log('[Reticulate] No foreground R session to check for interpreters');
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
	constructor(readonly manager: positron.LanguageRuntimeManager) { }

	async registerClient(client: positron.RuntimeClientInstance) {
		if (this._client) {
			throw new Error('Client already registered');
		}
		this._client = client;

		await this.manager.discoverRuntimes();
		positron.runtime.selectLanguageRuntime('reticulate');

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
		//positron.runtime.selectLanguageRuntime('reticulate');
		// Execute an empty code block to focus the console
		positron.runtime.executeCode('python', '', true, true);
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

	console.log('Reticulate extension activated');

	return manager;
}

