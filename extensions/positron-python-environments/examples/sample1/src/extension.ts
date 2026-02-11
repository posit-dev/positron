// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getEnvExtApi } from './pythonEnvsApi';
import { SampleEnvManager } from './sampleEnvManager';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    const api = await getEnvExtApi();

    const log = vscode.window.createOutputChannel('Sample Environment Manager', { log: true });
    context.subscriptions.push(log);

    const manager = new SampleEnvManager(log);
    context.subscriptions.push(api.registerEnvironmentManager(manager));
}

// This method is called when your extension is deactivated
export function deactivate() {}
