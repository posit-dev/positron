/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	createClientSocketTransport
} from 'vscode-languageclient/node';

// A global instance of the LSP language client provided by this language pack
let client: LanguageClient;

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let arkRuntime: vscode.LanguageRuntime;

export function activate(context: vscode.ExtensionContext) {

	let disposable = vscode.commands.registerCommand('ark.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ark!');
	});

	context.subscriptions.push(disposable);

    // Check to see whether the Jupyter Adapter extension is installed
    // and active. If so, we can start the language server.
    let ext = vscode.extensions.getExtension("posit.jupyter-adapter");
    if (!ext) {
		vscode.window.showErrorMessage("Could not find Jupyter Adapter extension; can't register ARK.");
		return;
	}

	// Read the ark.kernel.path setting to determine the path to the
	// R kernel executable.
	//
	// TODO: We should enumerate R installations on the system instead of
	// requiring the user to specify the path.
	let kernelPath = vscode.workspace.getConfiguration("ark").get("kernel.path");
	if (kernelPath) {
		// We have a kernel path; use the VS Code file system API to see if it exists on disk.
		let fs = require('fs');
		if (fs.existsSync(kernelPath)) {
			if (ext.isActive) {
				return registerArkKernel(ext, context, kernelPath as string);
			} else {
				ext.activate().then(() => {
					return registerArkKernel(ext!, context, kernelPath as string);
				});
			}
		} else {
			vscode.window.showErrorMessage("ARK kernel path specified in 'ark.kernel.path' setting does not exist: " + kernelPath);
			return;
		}
	} else {
		// No kernel path specified; show an error message.
		vscode.window.showErrorMessage("No path to the ARK kernel set. Please set the ark.kernel.path setting.");
	}
}

/**
 * Activate the language server; returns a promise that resolves to the port on
 * which the client is listening.
 *
 * @param ext The extension
 * @param context The extension context
 */
function activateLsp(ext: vscode.Extension<any> | null, context: vscode.ExtensionContext): Promise<number> {

	// TODO: Only create the output channel if the ark.trace.server option is set.
	let trace = vscode.window.createOutputChannel('ARK Language Server (Trace)');

	return new Promise((resolve, reject) => {

		// Define server options for the language server; this is a callback
		// that creates and returns the reader/writer stream for TCP
		// communication.
		let serverOptions = () => {
			// Find an open port for the language server to listen on.
			var portfinder = require('portfinder');
			trace.appendLine('Finding open port for R language server...');
			let stream = portfinder.getPortPromise()
				.then(async (port: number) => {
					let address = `127.0.0.1:${port}`;
					try {
						// Create our own socket transport
						const transport = await createClientSocketTransport(port);

						// Allow kernel startup to proceed
						resolve(port);

						// Wait for the language server to connect to us
						console.log(`Waiting to connect to language server at ${address}...`);
						const protocol = await transport.onConnected();
						console.log(`Connected to language server at ${address}, returning protocol transports`);

						return {
							reader: protocol[0],
							writer: protocol[1]
						};
					} catch (err) {
						vscode.window.showErrorMessage("Could not connect to language server: \n\n" + err);
						reject("Could not connect to language server: \n\n" + err);
					}
				})
				.catch((err: string) => {
					vscode.window.showErrorMessage("Could not find open port for language server: \n\n" + err);
					reject("Could not find open port for language server: \n\n" + err);
				});
			return stream;
		};

		let clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', language: 'r' }],
			synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R') },
			traceOutputChannel: trace
		};

		trace.appendLine('Creating ARK language client...');
		client = new LanguageClient('ark', 'ARK Language Server', serverOptions, clientOptions);
		client.onDidChangeState(event => {
			trace.appendLine(`ARK language client state changed ${event.oldState} => ${event.newState}`);
		});

		context.subscriptions.push(client.start());

		client.onReady().then(() => {
			trace.appendLine("ARK language client is ready");
		});
	});
};


export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

export function registerArkKernel(ext: vscode.Extension<any>,
    context: vscode.ExtensionContext,
    kernelPath: string): vscode.Disposable {

    let kernelSpec = {
        "argv": [ kernelPath, "--connection_file", "{connection_file}" ],
        "display_name": "Amalthea R Kernel (ARK)", // eslint-disable-line
        "language": "R",
        "env": {
            "RUST_LOG": "trace", // eslint-disable-line
            "R_HOME": "/Library/Frameworks/R.framework/Resources", // eslint-disable-line
			"RUST_BACKTRACE": "1" // eslint-disable-line
        }
    };

    // Create an adapter for the kernel to fulfill the LanguageRuntime interface.
    arkRuntime = ext.exports.adaptKernel(
        kernelSpec,
        () => {
			return activateLsp(ext, context);
		}
    );

    // Register a language runtime provider for the ARK kernel.
    return vscode.positron.registerLanguageRuntime(arkRuntime);
}
