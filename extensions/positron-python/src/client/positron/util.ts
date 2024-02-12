/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function withActiveExtension(ext: vscode.Extension<unknown>, callback: () => void) {

    if (ext.isActive) {
        callback();
    } else {
        ext.activate().then(callback);
    }

}

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
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function whenTimeout<T>(ms: number, fn: () => T): Promise<T> {
	await delay(ms);
	return fn();
}
