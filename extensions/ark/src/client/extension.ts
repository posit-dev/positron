/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    createClientSocketTransport,
    MessageTransports,
    MessageReader
} from "vscode-languageclient/node";
import { registerCommands } from "./commands";
import { initializeLogging, trace, traceOutputChannel } from './logging';
import { withActiveExtension } from "./util";

// A global instance of the LSP language client provided by this language pack
let client: LanguageClient;

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let runtime: vscode.LanguageRuntime;

export function activate(context: vscode.ExtensionContext) {

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
    const arkConfig = vscode.workspace.getConfiguration("ark");
    const kernelPath = arkConfig.get<string>("kernel.path");
    if (!kernelPath) {
        vscode.window.showErrorMessage("No path to the ARK kernel set. Please set the ark.kernel.path setting.");
        return;
    }

    // We have a kernel path; use the VS Code file system API to see if it exists on disk.
    let fs = require("fs");
    if (!fs.existsSync(kernelPath)) {
        vscode.window.showErrorMessage("ARK kernel path specified in 'ark.kernel.path' setting does not exist: " + kernelPath);
        return;
    }

    // Initialize logging tools.
    initializeLogging(context);

    // Register commands.
    registerCommands(context);

    withActiveExtension(ext, () => {
        return registerArkKernel(ext!, context, kernelPath as string);
    });
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): vscode.Disposable {

    let kernelSpec = {
        "argv": [kernelPath, "--connection_file", "{connection_file}"],
        "display_name": "Amalthea R Kernel (ARK)", // eslint-disable-line
        "language": "R",
        "env": {
            "RUST_LOG": "trace", // eslint-disable-line
            "R_HOME": "/Library/Frameworks/R.framework/Resources", // eslint-disable-line
            "RUST_BACKTRACE": "1" // eslint-disable-line
        }
    };

    // Create an adapter for the kernel to fulfill the LanguageRuntime interface.
    runtime = ext.exports.adaptKernel(kernelSpec, () => {
        return activateLsp(context);
    });

    // Register a language runtime provider for the ARK kernel.
    return vscode.positron.registerLanguageRuntime(runtime);

}

/**
 * Activate the language server; returns a promise that resolves to the port on
 * which the client is listening.
 *
 * @param context The VSCode extension context.
 */
async function activateLsp(context: vscode.ExtensionContext): Promise<number> {

    return new Promise((resolve, reject) => {

        // Define server options for the language server; this is a callback
        // that creates and returns the reader/writer stream for TCP
        // communication.
        let serverOptions = async () => {

            // Find an open port for the language server to listen on.
            trace("Finding open port for R language server...");
            var portfinder = require("portfinder");
            let port = await portfinder.getPortPromise();
            let address = `127.0.0.1:${port}`;

            // Create our own socket transport
            const transport = await createClientSocketTransport(port);

            // Allow kernel startup to proceed
            resolve(port);

            // Wait for the language server to connect to us
            trace(`Waiting to connect to language server at ${address}...`);
            const protocol = await transport.onConnected();
            trace(`Connected to language server at ${address}, returning protocol transports`);

            return {
                reader: protocol[0],
                writer: protocol[1],
            };

        };

        let clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: "file", language: "r" }],
            synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*.R") },
            traceOutputChannel: traceOutputChannel(),
        };

        trace("Creating ARK language client...");
        client = new LanguageClient("ark", "ARK Language Server", serverOptions, clientOptions);
        client.onDidChangeState(event => {
            trace(`ARK language client state changed ${event.oldState} => ${event.newState}`);
        });

        context.subscriptions.push(client.start());

        client.onReady().then(() => {
            trace("ARK language client is ready");
        });
    });
};

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
