import * as vscode from 'vscode';
export function registerTools<T>(name: string, tool: vscode.LanguageModelTool<T>): vscode.Disposable {
    return vscode.lm.registerTool(name, tool);
}
