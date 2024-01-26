/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Attempts to locate a copy of the Ark kernel. The kernel is searched for in the following
 * locations, in order:
 *
 * 1. The `positron.r.kernel.path` setting, if specified.
 * 2. The embedded kernel, if it exists (release builds).
 * 3. A locally built kernel (development builds for kernel developers).
 * 4. A local, downloaded copy of the kernel (development builds for everyone else).
 *
 * @param context The extension context.
 * @returns A path to the Ark kernel, or undefined if the kernel could not be found.
 */
export function getArkKernelPath(context: vscode.ExtensionContext): string | undefined {

	// First, check to see whether there is an override for the kernel path.
	const arkConfig = vscode.workspace.getConfiguration('positron.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		return kernelPath;
	}

	const kernelName = os.platform() === 'win32' ? 'ark.exe' : 'ark';

	// No kernel path specified; try the default (embedded) kernel. This is where the kernel
	// is placed in development and release builds.
	const path = require('path');
	const fs = require('fs');
	const embeddedKernel = path.join(context.extensionPath, 'resources', 'ark', kernelName);
	if (fs.existsSync(embeddedKernel)) {
		return embeddedKernel;
	}

	// Look for locally built Debug or Release kernels. If both exist, we'll use
	// whichever is newest. This is the location where the kernel is typically built
	// by developers, who have `positron` and `amalthea` directories side-by-side.
	let devKernel = undefined;
	const positronParent = path.dirname(path.dirname(path.dirname(context.extensionPath)));
	const devDebugKernel = path.join(positronParent, 'amalthea', 'target', 'debug', kernelName);
	const devReleaseKernel = path.join(positronParent, 'amalthea', 'target', 'release', kernelName);
	const debugModified = fs.statSync(devDebugKernel, { throwIfNoEntry: false })?.mtime;
	const releaseModified = fs.statSync(devReleaseKernel, { throwIfNoEntry: false })?.mtime;

	if (debugModified) {
		devKernel = (releaseModified && releaseModified > debugModified) ? devReleaseKernel : devDebugKernel;
	} else if (releaseModified) {
		devKernel = devReleaseKernel;
	}
	if (devKernel) {
		return devKernel;
	}
}
