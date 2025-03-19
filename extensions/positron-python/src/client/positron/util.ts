/* eslint-disable max-classes-per-file */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { traceVerbose } from '../logging';
import { PythonRuntimeSession } from './session';

export class PromiseHandles<T> {
    resolve!: (value: T | Promise<T>) => void;

    reject!: (error: unknown) => void;

    promise: Promise<T>;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function whenTimeout<T>(ms: number, fn: () => T): Promise<T> {
    await delay(ms);
    return fn();
}

// Check if the current workspace contains files matching any of the passed glob ptaterns
export async function hasFiles(includes: string[]): Promise<boolean> {
    // Create a single glob pattern e.g. ['a', 'b'] => '{a,b}'
    const include = `{${includes.join(',')}}`;
    traceVerbose(`Searching for _files_ with pattern: ${include}`);

    // Exclude node_modules for performance reasons
    const files = await vscode.workspace.findFiles(include, '**/node_modules/**', 1);
    traceVerbose(`Found _files_: ${files.map((file) => file.fsPath)}`);

    return files.length > 0;
}

export async function getActivePythonSessions(): Promise<PythonRuntimeSession[]> {
    const sessions = await positron.runtime.getActiveSessions();
    return sessions.filter((session) => session instanceof PythonRuntimeSession) as PythonRuntimeSession[];
}

export abstract class Disposable {
    protected _disposables: vscode.Disposable[] = [];

    public dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    protected _register<T extends vscode.Disposable>(value: T): T {
        this._disposables.push(value);
        return value;
    }
}
