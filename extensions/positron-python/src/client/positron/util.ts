/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

/**
 * Retrieves the user's default Python interpreter path from VS Code settings
 *
 * @returns The configured Python interpreter path if it exists and is not 'python',
 *          otherwise returns an empty string
 */
export function getUserDefaultInterpreter(): string {
    const configuration = vscode.workspace.getConfiguration('python');
    const defaultInterpreterPath = configuration?.get<string>('defaultInterpreterPath');
    return !defaultInterpreterPath || defaultInterpreterPath === 'python' ? '' : defaultInterpreterPath;
}
