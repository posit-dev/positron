/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterKernelSpec, JupyterSession } from './jupyter-adapter.d';

export class ReticulateRuntimeManager implements positron.LanguageRuntimeManager {

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
	}

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		return reticulateRuntimesDiscoverer();
	}

	createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {
		return createReticulateSession(runtimeMetadata, sessionMetadata);
	}
}

async function createReticulateSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata) {

	const rRuntime = await positron.runtime.getPreferredRuntime('r');
	rRuntime.extraRuntimeData.display_name = 'Reticulate R Session';

	const rSession = await positron.runtime.startLanguageRuntime(
		rRuntime!.runtimeId,
		rRuntime!.runtimeName,
	);

	//session.execute('reticulate::repl_python()');
	const startKernel = async (session: JupyterSession, self: any) => {
		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;
		const profileFile = session.state.profileFile;
		const logLevel = 'debug';

		const kernelPath = `${__dirname}/../../positron-python/python_files/positron/positron_language_server.py`;

		const code = `
		positron_python_session <- function() {
			sys <- reticulate::import("sys", convert = FALSE)
			old_argv <- sys$argv
			old_exit <- sys$exit

			on.exit({
				sys$argv <- old_argv
				sys$exit <- old_exit
			})

			lsp_path <-  "${kernelPath}"
			sys$argv <- list(
				reticulate::py_exe(), lsp_path,
				'-f', "${connnectionFile}",
				'--logfile', "${logFile}",
				'--loglevel', '${logLevel}',
				'--session-mode', 'console'
			)

			sys$exit <- reticulate::py_run_string(glue::trim("
				def exit(status=None):
					return status
				"), local = TRUE, convert = FALSE )$exit

			reticulate::py_run_file(lsp_path, prepend_path = TRUE)
		}
		positron_python_session()
		`;

		// this is the piece of code that initializes IPython in the R session.
		rSession.execute(
			code,
			'reticulate-session',
			positron.RuntimeCodeExecutionMode.Transient,
			positron.RuntimeErrorBehavior.Continue,
		);

		while (true) {
			try {
				await self.connectToSession(session);
				return;
			} catch {

			}
		}
	};

	const kernelSpec: JupyterKernelSpec = {
		'argv': [],
		'display_name': "Reticulate Python Session", // eslint-disable-line
		'language': 'Python',
		'env': {},
		'startKernel': startKernel,
	};

	const api = vscode.extensions.getExtension('ms-python.python')?.exports;
	const pythonRuntimeMetadata = await positron.runtime.getPreferredRuntime('python');
	runtimeMetadata.extraRuntimeData = pythonRuntimeMetadata.extraRuntimeData;
	console.log('Python runtime metadata:', runtimeMetadata);
	const pythonSession = new api.positron(runtimeMetadata, sessionMetadata, api.serviceContainer, kernelSpec);
	return pythonSession;
}

async function* reticulateRuntimesDiscoverer() {
	yield new ReticulateRuntimeMetadata();
}

class ReticulateRuntimeMetadata implements positron.LanguageRuntimeMetadata {
	extraRuntimeData: any
	base64EncodedIconSvg: string | undefined;
	constructor() {
		this.base64EncodedIconSvg = '';
	}
	runtimePath: string = '';
	runtimeName: string = 'Reticulate';
	languageId: string = 'reticulate';
	languageName: string = 'Reticulate';
	runtimeId: string = 'reticulate';
	runtimeShortName: string = 'Reticulate';
	runtimeVersion: string = '1.0';
	runtimeSource: string = 'reticulate';
	languageVersion = '1.0';
	startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Immediate;
	sessionLocation: positron.LanguageRuntimeSessionLocation = positron.LanguageRuntimeSessionLocation.Workspace;
}



/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('Activating Reticulate extension');

	const manager = positron.runtime.registerLanguageRuntimeManager(
		new ReticulateRuntimeManager(context)
	);

	console.log('Reticulate extension activated');

	return manager;
}

