/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	createClientSocketTransport
} from 'vscode-languageclient/node';

let client: LanguageClient;
export function activate(context: vscode.ExtensionContext) {

	console.log('Activating ARK language server extension');

	let disposable = vscode.commands.registerCommand('ark.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ark!');
	});

	context.subscriptions.push(disposable);

    // Check to see whether the Jupyter Adapter extension is installed
    // and active. If so, we can start the language server.
    let ext = vscode.extensions.getExtension("posit.jupyter-adapter");
    if (ext) {
        // We're in Positron, so need to create a language runtime.

        // Read the ark.kernel.path setting to determine the path to the
        // R kernel executable.
        let kernelPath = vscode.workspace.getConfiguration("ark").get("kernel.path");
        if (kernelPath) {
            // We have a kernel path; use the VS Code file system API to see if it exists on disk.
            let fs = require('fs');
            if (fs.existsSync(kernelPath)) {
				if (ext.isActive) {
					return startArkKernel(ext, context, kernelPath as string);
				} else {
					ext.activate().then(() => {
						return startArkKernel(ext!, context, kernelPath as string);
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
        // TODO: This needs to pass a JupyterKernelSpec describing the location
        // of the R kernel.
        return ext.exports.adaptKernel();
    }
    else {
        // Locate the Myriac Console extension, which supplies the other side of the language server.
        let ext = vscode.extensions.getExtension("RStudio.myriac-console");
        if (ext) {
            return activateVscode(ext, context);
        } else {
            return activateLsp(null, context);
        }
    }
}

function activateVscode(ext: vscode.Extension<any>, context: vscode.ExtensionContext) {

	// Ensure that the extension is active, so that it can receive the request
	// to start the language server.
	if (ext.isActive) {
		console.log("Myriac Console extension is active, starting language server");
		activateLsp(ext, context);
	} else {
		console.log("Activating Myriac Console extension...");
		ext.activate().then(() => {
			console.log("Myriac Console extension activated, starting language server");
			activateLsp(ext, context);
		});
	}

}

/**
 * Activate the language server.
 *
 * @param context The extension context
 */
function activateLsp(ext: vscode.Extension<any> | null, context: vscode.ExtensionContext) {

	let serverOptions = () => {
		// Find an open port for the language server to listen on.
		var portfinder = require('portfinder');
		console.info('Finding open port for R language server...');
		let stream = portfinder.getPortPromise()
			.then(async (port: number) => {
				let address = `127.0.0.1:${port}`;
				try {
					// Create our own socket transport
					const transport = await createClientSocketTransport(port);

					// Ask Myriac to start the language server
					console.log(`Requesting Myriac Console extension to start R language server at ${address}...`);
					ext?.exports.startLsp("R", address);
					// TODO: Need to handle errors arising from LSP startup.

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
				}
			})
			.catch((err: string) => {
				vscode.window.showErrorMessage("Could not find open port for language server: \n\n" + err);
			});
		return stream;
	};

	// TODO: Only create the output channel if the ark.trace.server option is set.
	let trace = vscode.window.createOutputChannel('ARK Language Server (Trace)');
	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'r' }],
		synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R') },
		traceOutputChannel: trace
	};

	console.log('Creating language client');
	client = new LanguageClient('ark', 'ARK Language Server', serverOptions, clientOptions);
	client.onDidChangeState(event => {
		trace.appendLine(`Language client state changed ${event.oldState} => ${event.newState}`);
	});
	client.onReady().then(() => {
		trace.appendLine("Language client is ready");
	});

	context.subscriptions.push(client.start());
};


export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

export function startArkKernel(ext: vscode.Extension<any>,
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
    let kernel = ext.exports.adaptKernel(
        kernelSpec,
        true // has embedded LSP
    );

    // Register a language runtime provider for the ARK kernel.
    return vscode.myriac.registerLanguageRuntime(kernel);
}
