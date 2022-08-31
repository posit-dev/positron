"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const node_1 = require("vscode-languageclient/node");
let client;
function activate(context) {
    console.log('Activating ARK language server extension');
    let disposable = vscode.commands.registerCommand('ark.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from ark!');
    });
    context.subscriptions.push(disposable);
    // Locate the Myriac Console extension, which supplies the other side of the language server.
    let ext = vscode.extensions.getExtension("RStudio.myriac-console");
    if (!ext) {
        vscode.window.showErrorMessage("Could not find Myriac Console extension; please install it.\n\n" +
            "R language server will not be available.");
        return null;
    }
    // Ensure that the extension is active, so that it can receive the request
    // to start the language server.
    if (ext.isActive) {
        console.log("Myriac Console extension is active, starting language server");
        activateLsp(ext, context);
    }
    else {
        console.log("Activating Myriac Console extension...");
        ext.activate().then(() => {
            console.log("Myriac Console extension activated, starting language server");
            activateLsp(ext, context);
        });
    }
}
exports.activate = activate;
/**
 * Activate the language server.
 *
 * @param context The extension context
 */
function activateLsp(ext, context) {
    let serverOptions = () => {
        // Find an open port for the language server to listen on.
        var portfinder = require('portfinder');
        console.info('Finding open port for R language server...');
        let stream = portfinder.getPortPromise()
            .then(async (port) => {
            let address = `127.0.0.1:${port}`;
            try {
                // Create our own socket transport
                const transport = await (0, node_1.createClientSocketTransport)(port);
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
            }
            catch (err) {
                vscode.window.showErrorMessage("Could not connect to language server: \n\n" + err);
            }
        })
            .catch((err) => {
            vscode.window.showErrorMessage("Could not find open port for language server: \n\n" + err);
        });
        return stream;
    };
    // TODO: Only create the output channel if the ark.trace.server option is set.
    let trace = vscode.window.createOutputChannel('ARK Language Server (Trace)');
    let clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'r' }],
        synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R') },
        traceOutputChannel: trace
    };
    console.log('Creating language client');
    client = new node_1.LanguageClient('ark', 'ARK Language Server', serverOptions, clientOptions);
    client.onDidChangeState(event => {
        trace.appendLine(`Language client state changed ${event.oldState} => ${event.newState}`);
    });
    client.onReady().then(() => {
        trace.appendLine("Language client is ready");
    });
    context.subscriptions.push(client.start());
}
;
function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map