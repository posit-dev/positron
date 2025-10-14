/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { EXTENSION_ROOT_DIR } from './constants';

interface ArkKernelLookupOptions {
	readonly rBinaryPath?: string;
	readonly rHomePath?: string;
	readonly rArch?: string;
}

type WindowsKernelArch = 'arm64' | 'x64' | 'x86';

/**
 * Attempts to locate a copy of the Ark kernel. The kernel is searched for in the following
 * locations, in order:
 *
 * 1. The `positron.r.kernel.path` setting, if specified.
 * 2. The embedded kernel, if it exists (release builds).
 * 3. A locally built kernel (development builds for kernel developers).
 * 4. A local, downloaded copy of the kernel (development builds for everyone else).
 *
 * @param options Additional hints that help resolve the correct kernel path.
 * @returns A path to the Ark kernel, or undefined if the kernel could not be found.
 */
export function getArkKernelPath(options?: ArkKernelLookupOptions): string | undefined {

	// First, check to see whether there is an override for the kernel path.
	const arkConfig = vscode.workspace.getConfiguration('positron.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		return kernelPath;
	}

	const kernelName = os.platform() === 'win32' ? 'ark.exe' : 'ark';

	// Look for locally built Debug or Release kernels. If both exist, we'll use
	// whichever is newest. This is the location where the kernel is typically built
	// by developers, who have `positron` and `ark` directories side-by-side.
	let devKernel: string | undefined;
	const positronParent = path.dirname(path.dirname(path.dirname(EXTENSION_ROOT_DIR)));
	const devDebugKernel = path.join(positronParent, 'ark', 'target', 'debug', kernelName);
	const devReleaseKernel = path.join(positronParent, 'ark', 'target', 'release', kernelName);
	const debugModified = safeStatSync(devDebugKernel)?.mtime;
	const releaseModified = safeStatSync(devReleaseKernel)?.mtime;

	if (debugModified) {
		devKernel = (releaseModified && releaseModified > debugModified) ? devReleaseKernel : devDebugKernel;
	} else if (releaseModified) {
		devKernel = devReleaseKernel;
	}
	if (devKernel) {
		LOGGER.info('Loading Ark from disk in adjacent repo. Make sure it\'s up-to-date.');
		return devKernel;
	}

	const arkRoot = path.join(EXTENSION_ROOT_DIR, 'resources', 'ark');

	if (os.platform() === 'win32') {
		const embeddedKernel = resolveWindowsEmbeddedKernel(arkRoot, kernelName, options);
		if (embeddedKernel) {
			return embeddedKernel;
		}
	} else {
		const embeddedKernel = path.join(arkRoot, kernelName);
		if (fs.existsSync(embeddedKernel)) {
			return embeddedKernel;
		}
	}

	return undefined;
}

function resolveWindowsEmbeddedKernel(
	arkRoot: string,
	kernelName: string,
	options?: ArkKernelLookupOptions
): string | undefined {
	const preferredArch = determineWindowsKernelArch(options);
	const searchOrder = getWindowsSearchOrder(preferredArch);
	for (const subdir of searchOrder) {
		const candidate = path.join(arkRoot, subdir, kernelName);
		const stats = safeStatSync(candidate);
		if (stats?.isFile()) {
			return candidate;
		}
	}

	const fallback = path.join(arkRoot, kernelName);
	if (fs.existsSync(fallback)) {
		return fallback;
	}

	return undefined;
}

function determineWindowsKernelArch(options?: ArkKernelLookupOptions): WindowsKernelArch | undefined {
	if (!options) {
		return undefined;
	}

	const normalized = normalizeWindowsArch(options.rArch);
	if (normalized) {
		return normalized;
	}

	const sniffed = sniffWindowsBinaryArchitecture(options.rBinaryPath);
	if (sniffed) {
		return sniffed;
	}

	return deriveArchFromPaths([options.rBinaryPath, options.rHomePath]);
}

function normalizeWindowsArch(value: string | undefined): WindowsKernelArch | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.toLowerCase();
	if (normalized === 'arm64' || normalized === 'aarch64') {
		return 'arm64';
	}
	if (normalized === 'x64' || normalized === 'x86_64' || normalized === 'amd64') {
		return 'x64';
	}
	if (normalized === 'x86' || normalized === 'i386' || normalized === 'ia32') {
		return 'x86';
	}
	return undefined;
}

function deriveArchFromPaths(paths: Array<string | undefined>): WindowsKernelArch | undefined {
	for (const candidate of paths) {
		if (!candidate) {
			continue;
		}
		const normalized = candidate.toLowerCase().replace(/\\/g, '/');
		if (/(^|\/)arm64(\/|$)/.test(normalized) || normalized.includes('-arm64')) {
			return 'arm64';
		}
		if (/(^|\/)(x64|amd64)(\/|$)/.test(normalized)) {
			return 'x64';
		}
		if (/(^|\/)(x86|i386)(\/|$)/.test(normalized)) {
			return 'x86';
		}
	}
	return undefined;
}

function getWindowsSearchOrder(preferred?: WindowsKernelArch): string[] {
	if (preferred === 'arm64') {
		return ['windows-arm64', 'windows-x64'];
	}
	if (preferred === 'x64' || preferred === 'x86') {
		return ['windows-x64', 'windows-arm64'];
	}
	if (process.arch === 'arm64') {
		return ['windows-arm64', 'windows-x64'];
	}
	return ['windows-x64', 'windows-arm64'];
}

function safeStatSync(targetPath: string): fs.Stats | undefined {
	try {
		return fs.statSync(targetPath);
	} catch {
		return undefined;
	}
}

function sniffWindowsBinaryArchitecture(binaryPath?: string): WindowsKernelArch | undefined {
	if (!binaryPath) {
		return undefined;
	}
	try {
		const fd = fs.openSync(binaryPath, 'r');
		try {
			const header = Buffer.alloc(64);
			fs.readSync(fd, header, 0, header.length, 0);
			const peOffset = header.readUInt32LE(0x3C);
			const peHeader = Buffer.alloc(6);
			fs.readSync(fd, peHeader, 0, peHeader.length, peOffset);
			if (peHeader.toString('utf8', 0, 2) !== 'PE') {
				return undefined;
			}
			const machine = peHeader.readUInt16LE(4);
			switch (machine) {
				case 0xAA64:
					return 'arm64';
				case 0x8664:
					return 'x64';
				case 0x14c:
					return 'x86';
				default:
					return undefined;
			}
		} finally {
			fs.closeSync(fd);
		}
	} catch (error) {
		LOGGER.debug(`Unable to determine Windows R architecture from ${binaryPath}: ${error}`);
		return undefined;
	}
}
