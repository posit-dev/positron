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
