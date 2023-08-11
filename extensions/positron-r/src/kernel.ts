/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function getArkKernelPath(context: vscode.ExtensionContext): string | undefined {

	// First, check to see whether there is an override for the kernel path.
	const arkConfig = vscode.workspace.getConfiguration('positron.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		return kernelPath;
	}

	// No kernel path specified; try the default (embedded) kernel.
	const path = require('path');
	const fs = require('fs');
	const embeddedKernel = path.join(context.extensionPath, 'dist', 'bin', 'ark');
	if (fs.existsSync(embeddedKernel)) {
		return embeddedKernel;
	}
}
