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

export function promiseHandles() {
	const out = {
		resolve: (_value?: unknown) => { },
		reject: (_reason?: any) => { },
		promise: null as unknown as Promise<unknown>,
	};

	const promise = new Promise((resolve, reject) => {
		out.resolve = resolve;
		out.reject = reject;
	});
	out.promise = promise;

	return out;
}
