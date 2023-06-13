/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function withActiveExtension(ext: vscode.Extension<any>, callback: () => void) {

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
		})
	}
}
