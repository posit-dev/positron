/* eslint-disable max-classes-per-file */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { traceVerbose } from '../logging';

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

/**
 * Get the actual Python executable path for a conda environment.
 */
export function getCondaPythonPath(envPath: string | undefined): string | undefined {
    if (!envPath) {
        return undefined;
    }
    if (process.platform === 'win32') {
        const pythonPath = path.join(envPath, 'Scripts', 'python.exe');
        return fs.existsSync(pythonPath) ? pythonPath : undefined;
    }
    // On Unix, try 'python' first, then 'python3'
    const pythonPath = path.join(envPath, 'bin', 'python');
    if (fs.existsSync(pythonPath)) {
        return pythonPath;
    }
    const python3Path = path.join(envPath, 'bin', 'python3');
    if (fs.existsSync(python3Path)) {
        return python3Path;
    }
    return undefined;
}
