/* eslint-disable @typescript-eslint/no-explicit-any */
import { commands } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';

export function registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable {
    return commands.registerCommand(command, callback, thisArg);
}

export function executeCommand<T = unknown>(command: string, ...rest: any[]): Thenable<T> {
    return commands.executeCommand(command, ...rest);
}
