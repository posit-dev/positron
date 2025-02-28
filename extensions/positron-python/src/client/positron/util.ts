/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Resource, InspectInterpreterSettingType } from '../common/types';

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
export function getUserDefaultInterpreter(scope?: Resource): InspectInterpreterSettingType {
    const configuration = vscode.workspace.getConfiguration('python', scope);
    const defaultInterpreterPath: InspectInterpreterSettingType =
        configuration?.inspect<string>('defaultInterpreterPath') ?? {};

    // 'python' is the default for this setting. we only want to know if it has changed
    if (defaultInterpreterPath.globalValue === 'python') {
        defaultInterpreterPath.globalValue = '';
    }
    if (defaultInterpreterPath.workspaceValue === 'python') {
        defaultInterpreterPath.workspaceValue = '';
    }
    if (defaultInterpreterPath.workspaceFolderValue === 'python') {
        defaultInterpreterPath.workspaceFolderValue = '';
    }
    return defaultInterpreterPath;
}
