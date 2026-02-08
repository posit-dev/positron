/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { EXTENSION_ROOT_DIR } from './constants';

/**
 * Options that help locate the Ark kernel binary.
 */
interface ArkKernelLookupOptions {
	/// The path to the R binary, if known.
	readonly rBinaryPath?: string;

	/// The R_HOME path, if known.
	readonly rHomePath?: string;

	/// The architecture of the R binary, if known.
	readonly rArch?: string;
}

type WindowsKernelArch = 'arm64' | 'x64';

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
		// On Windows, we need additional logic to locate the correct kernel
		// binary since it may be in a subdirectory based on architecture.
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

/**
 * Resolves the path to the embedded Ark kernel on Windows.
 *
 * @param arkRoot The root directory of the Ark installation.
 * @param kernelName The name of the kernel executable.
 * @param options Additional options for kernel resolution.
 *
 * @returns The path to the embedded kernel, or undefined if not found.
 */
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

/**
 * Determines the architecture of the Ark kernel on Windows.
 *
 * @param options Kernel lookup options.
 * @returns The architecture of the kernel, or undefined if not found.
 */
function determineWindowsKernelArch(options?: ArkKernelLookupOptions): WindowsKernelArch | undefined {
	if (!options) {
		return undefined;
	}

	// First, see if the architecture was explicitly specified.
	const normalized = normalizeWindowsArch(options.rArch);
	if (normalized) {
		LOGGER.debug(`Using previously detected Windows architecture: ${normalized}`);
		return normalized;
	}

	// If unknown, peek at the R binary, if we have one.
	const sniffed = sniffWindowsBinaryArchitecture(options.rBinaryPath);
	if (sniffed) {
		LOGGER.debug(`Sniffed Windows architecture from R binary: ${sniffed}`);
		return sniffed;
	}

	// In the absence of any other information, try to derive the architecture
	// from the R binary and R_HOME paths, if we have them.
	const arch = deriveArchFromPaths([options.rBinaryPath, options.rHomePath]);
	if (arch) {
		LOGGER.debug(`Derived Windows architecture from ${options.rBinaryPath} and ${options.rHomePath}: ${arch}`);
		return arch;
	}
}

/**
 * Normalizes a Windows architecture string.
 *
 * @param value The architecture string to normalize.
 * @returns The normalized architecture, or undefined if not recognized.
 */
export function normalizeWindowsArch(value: string | undefined): WindowsKernelArch | undefined {
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
	return undefined;
}

/**
 * Derives the architecture of the Ark kernel from a list of paths.
 *
 * @param paths
 * @returns The derived architecture, or undefined if not found.
 */
function deriveArchFromPaths(paths: Array<string | undefined>): WindowsKernelArch | undefined {
	for (const candidate of paths) {
		if (!candidate) {
			continue;
		}
		const normalized = candidate.toLowerCase().replace(/\\/g, '/');
		if (/(^|\/)arm64(\/|$)/.test(normalized) || normalized.includes('-arm64')) {
			return 'arm64';
		}
		if (/(^|\/)aarch64(\/|$)/.test(normalized) || normalized.includes('-aarch64')) {
			return 'arm64';
		}
		if (/(^|\/)(x64|amd64)(\/|$)/.test(normalized)) {
			return 'x64';
		}
	}
	return undefined;
}

/***
 * Get the search order for Windows kernel architectures, based on a preferred
 * architecture.
 */
function getWindowsSearchOrder(preferred?: WindowsKernelArch): string[] {
	if (preferred === 'arm64') {
		return ['windows-arm64', 'windows-x64'];
	}
	if (preferred === 'x64') {
		return ['windows-x64', 'windows-arm64'];
	}
	if (process.arch === 'arm64') {
		return ['windows-arm64', 'windows-x64'];
	}
	return ['windows-x64', 'windows-arm64'];
}

/**
 * Wrapper around `fs.statSync` that returns `undefined` if the path does not exist
 * or is otherwise inaccessible.
 *
 * @param targetPath The path to check.
 * @returns The file stats, or undefined if the path is inaccessible.
 */
function safeStatSync(targetPath: string): fs.Stats | undefined {
	try {
		return fs.statSync(targetPath);
	} catch {
		return undefined;
	}
}

/**
 * Sniffs the architecture of a Windows binary by examining its PE header.
 *
 * @param binaryPath The path to the binary file.
 * @returns The detected architecture, or undefined if not recognized.
 */
export function sniffWindowsBinaryArchitecture(binaryPath?: string): WindowsKernelArch | undefined {
	if (!binaryPath) {
		return undefined;
	}
	try {
		const fd = fs.openSync(binaryPath, 'r');
		try {
			// Read the PE header to determine the architecture.
			const header = Buffer.alloc(64);
			fs.readSync(fd, header, 0, header.length, 0);
			const peOffset = header.readUInt32LE(0x3C);
			const peHeader = Buffer.alloc(6);
			fs.readSync(fd, peHeader, 0, peHeader.length, peOffset);
			if (peHeader.toString('utf8', 0, 2) !== 'PE') {
				// Not a PE file.
				return undefined;
			}
			// Read the machine type from the PE header.
			const machine = peHeader.readUInt16LE(4);
			switch (machine) {
				case 0xAA64:
					LOGGER.debug(`Detected ARM64 architecture for Windows binary at ${binaryPath}`);
					return 'arm64';
				case 0x8664:
					LOGGER.debug(`Detected x64 architecture for Windows binary at ${binaryPath}`);
					return 'x64';
				case 0x14c:
					LOGGER.debug(`Detected x86 architecture for Windows binary at ${binaryPath} (unsupported)`);
					return undefined; // 32 bit x86, which we don't support
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

/**
 * Sets up ark as a discoverable Jupyter kernel so that external tools like
 * Quarto can find it via `jupyter kernelspec list`.
 *
 * This creates a kernel.json file in the extension's global storage and sets
 * JUPYTER_PATH to point to it. This is done at extension activation time so
 * that ark is available even before an R session is started.
 *
 * @param context The extension context
 */
export function setupArkJupyterKernel(context: vscode.ExtensionContext): void {
	const arkPath = getArkKernelPath();
	if (!arkPath) {
		LOGGER.debug('Could not find ark kernel path; skipping Jupyter kernel setup');
		return;
	}

	// Create kernel.json content (without R_HOME - ark will discover R on its own)
	const kernelSpec = {
		argv: [
			arkPath,
			'--connection_file',
			'{connection_file}',
			'--session-mode',
			'notebook'
		],
		display_name: 'Ark R Kernel',
		language: 'R',
		env: {
			RUST_LOG: 'error'
		}
	};

	// Write to globalStorage/jupyter/kernels/ark/kernel.json
	const jupyterDir = path.join(context.globalStorageUri.fsPath, 'jupyter');
	const kernelDir = path.join(jupyterDir, 'kernels', 'ark');
	const kernelJsonPath = path.join(kernelDir, 'kernel.json');
	const kernelSpecJson = JSON.stringify(kernelSpec, null, 2);

	try {
		// Only write if the content has changed to avoid unnecessary disk writes
		const existing = fs.existsSync(kernelJsonPath)
			? fs.readFileSync(kernelJsonPath, 'utf8')
			: null;

		if (existing !== kernelSpecJson) {
			fs.mkdirSync(kernelDir, { recursive: true });
			fs.writeFileSync(kernelJsonPath, kernelSpecJson);
			LOGGER.debug(`Wrote ark kernel spec to ${kernelDir}`);
		}
	} catch (err) {
		LOGGER.error(`Failed to write ark kernel spec: ${err}`);
		return;
	}

	// Set JUPYTER_PATH so Quarto/Jupyter can find ark.
	// Using replace (not prepend) to avoid duplication issues with persisted
	// environment variable collections across restarts. We manually preserve
	// the user's original JUPYTER_PATH by reading from process.env (the extension
	// host's environment, before any collection mutations are applied).
	const collection = context.environmentVariableCollection;
	const pathSeparator = os.platform() === 'win32' ? ';' : ':';
	const originalJupyterPath = process.env.JUPYTER_PATH;
	const newJupyterPath = originalJupyterPath
		? `${jupyterDir}${pathSeparator}${originalJupyterPath}`
		: jupyterDir;
	collection.clear();
	collection.replace('JUPYTER_PATH', newJupyterPath, {
		applyAtProcessCreation: true,
		applyAtShellIntegration: true
	});
	LOGGER.debug(`Prepended ${jupyterDir} to JUPYTER_PATH`);
}
