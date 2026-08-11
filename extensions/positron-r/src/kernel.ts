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
 * 2. A fresh build in the ark submodule's `target/{release,debug}` directory.
 *    This is the dev fast path: a `cargo build` in the submodule is picked up
 *    immediately without re-running install-kernel.
 * 3. The embedded kernel under `resources/ark/`. This is what install-kernel
 *    populates from a prebuild download (or a copy of the local build) and
 *    what ships in the packaged extension.
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

	// Look for a locally-built ark in the submodule. If both debug and release
	// builds exist, use the newer one. This lets developers iterate on ark
	// without re-running `npm install` to repopulate `resources/ark/`.
	const submoduleRoot = path.join(EXTENSION_ROOT_DIR, 'ark');
	const submoduleDebug = path.join(submoduleRoot, 'target', 'debug', kernelName);
	const submoduleRelease = path.join(submoduleRoot, 'target', 'release', kernelName);
	const debugModified = safeStatSync(submoduleDebug)?.mtime;
	const releaseModified = safeStatSync(submoduleRelease)?.mtime;

	let submoduleKernel: string | undefined;
	if (debugModified) {
		submoduleKernel = (releaseModified && releaseModified > debugModified) ? submoduleRelease : submoduleDebug;
	} else if (releaseModified) {
		submoduleKernel = submoduleRelease;
	}
	if (submoduleKernel) {
		LOGGER.info(`Loading Ark from submodule build at ${submoduleKernel}.`);
		return submoduleKernel;
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
 * Prepend a library directory to an existing (possibly undefined) path-style
 * environment variable value, avoiding a trailing separator when there is no
 * existing value.
 *
 * @param libDir The library directory to place at the front.
 * @param existing The current value of the environment variable, if any.
 * @returns The combined value with `libDir` first.
 */
function prependLibDir(libDir: string, existing: string | undefined): string {
	return existing ? `${libDir}:${existing}` : libDir;
}

/**
 * Returns the base environment variables needed to run ark with a given R installation.
 * This includes R_HOME and platform-specific library paths.
 *
 * @param rHomePath The R_HOME path for the R installation
 * @returns A record of environment variables
 */
export function getArkEnvironmentVariables(rHomePath: string): Record<string, string> {
	const env: Record<string, string> = {
		R_HOME: rHomePath
	};

	// Set library paths to help ark find R's shared libraries. Prepend R's lib
	// directory to any existing value rather than clobbering it: the kernel spec
	// environment is applied to the supervisor's environment before the kernel's
	// startup command runs (e.g. `module load`), and the kcserver process
	// inherits Positron's environment. Clobbering would drop library paths the
	// user (or an environment module) already contributed. See
	// getArkEnvironmentVariables callers and the Kallichore EnvironmentResolver.
	if (process.platform === 'linux') {
		// Workaround for https://github.com/posit-dev/positron/issues/1619
		env['LD_LIBRARY_PATH'] = prependLibDir(rHomePath + '/lib', process.env.LD_LIBRARY_PATH);
	}
	if (process.platform === 'darwin') {
		// Workaround for https://github.com/posit-dev/positron/issues/3732
		env['DYLD_LIBRARY_PATH'] = prependLibDir(rHomePath + '/lib', process.env.DYLD_LIBRARY_PATH);
	}

	return env;
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

/** Architecture as reported by `RInstallation.arch` (Rig-style, e.g. arm64, x86_64). */
type MachOArch = 'arm64' | 'x86_64';

// Mach-O magic numbers (see <mach-o/loader.h> and <mach-o/fat.h>).
const MH_MAGIC_64 = 0xfeedfacf;   // thin 64-bit, host-endian (little-endian on disk today)
const MH_CIGAM_64 = 0xcffaedfe;   // thin 64-bit, byte-swapped
const FAT_MAGIC = 0xcafebabe;     // universal (fat) binary, big-endian
const FAT_MAGIC_64 = 0xcafebabf;  // universal (fat) binary with 64-bit offsets

// CPU types (see <mach/machine.h>). The 0x01000000 bit is CPU_ARCH_ABI64.
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

/**
 * Maps a Mach-O `cputype` value to the architecture strings used by
 * `RInstallation.arch`.
 */
function machOArchFromCpuType(cpuType: number): MachOArch | undefined {
	switch (cpuType >>> 0) {
		case CPU_TYPE_ARM64:
			return 'arm64';
		case CPU_TYPE_X86_64:
			return 'x86_64';
		default:
			return undefined;
	}
}

/**
 * Sniffs the architecture of a macOS binary by examining its Mach-O header.
 *
 * The conda-forge `Built` field records the (cross-compilation) build farm's
 * platform rather than the installed binary's architecture, so the actual
 * Mach-O header is the reliable source. This is the macOS analog of
 * {@link sniffWindowsBinaryArchitecture}.
 *
 * For universal (fat) binaries, the slice matching the current process
 * architecture is preferred (that is the slice macOS runs natively); if there
 * is no such slice but only one slice exists, that slice is returned.
 *
 * @param binaryPath The path to the Mach-O executable (e.g. `<R home>/bin/exec/R`).
 * @returns The detected architecture, or undefined if it can't be determined.
 */
export function sniffMachOBinaryArchitecture(binaryPath?: string): MachOArch | undefined {
	if (!binaryPath) {
		return undefined;
	}
	try {
		const fd = fs.openSync(binaryPath, 'r');
		try {
			// Enough to cover the fat header plus a handful of fat_arch entries.
			const header = Buffer.alloc(4096);
			const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
			if (bytesRead < 8) {
				return undefined;
			}

			// Fat headers and their fields are stored big-endian on disk.
			const magicBE = header.readUInt32BE(0);
			if (magicBE === FAT_MAGIC || magicBE === FAT_MAGIC_64) {
				const is64 = magicBE === FAT_MAGIC_64;
				const nFatArch = header.readUInt32BE(4);
				// fat_arch is 20 bytes; fat_arch_64 is 32 bytes. cputype is the first field.
				const entrySize = is64 ? 32 : 20;
				const arches = new Set<MachOArch>();
				for (let i = 0; i < nFatArch; i++) {
					const offset = 8 + i * entrySize;
					if (offset + 4 > bytesRead) {
						break;
					}
					const arch = machOArchFromCpuType(header.readUInt32BE(offset));
					if (arch) {
						arches.add(arch);
					}
				}
				// Prefer the slice that matches the host, since that is what runs natively.
				const hostArch: MachOArch | undefined =
					process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : undefined;
				if (hostArch && arches.has(hostArch)) {
					return hostArch;
				}
				return arches.size === 1 ? [...arches][0] : undefined;
			}

			// Thin Mach-O: read the magic in both byte orders to determine endianness,
			// then read the cputype (the field immediately after the magic).
			const magicLE = header.readUInt32LE(0);
			if (magicLE === MH_MAGIC_64) {
				return machOArchFromCpuType(header.readUInt32LE(4));
			}
			if (magicLE === MH_CIGAM_64) {
				return machOArchFromCpuType(header.readUInt32BE(4));
			}

			// Not a 64-bit Mach-O we recognize (e.g. legacy 32-bit), which we don't support.
			return undefined;
		} finally {
			fs.closeSync(fd);
		}
	} catch (error) {
		LOGGER.debug(`Unable to determine macOS R architecture from ${binaryPath}: ${error}`);
		return undefined;
	}
}

/**
 * Sets up ark as a discoverable Jupyter kernel so that external tools like
 * Quarto can find it via `jupyter kernelspec list`.
 *
 * This creates a kernel.json file in the extension's global storage and sets
 * JUPYTER_PATH to point to it. The kernel spec includes R-specific environment
 * variables so ark uses the same R installation as the active Positron console.
 *
 * @param context The extension context
 * @param rHomePath The R_HOME path for the active R installation
 */
export function setupArkJupyterKernel(
	context: vscode.ExtensionContext,
	rHomePath: string
): void {
	const arkPath = getArkKernelPath();
	if (!arkPath) {
		LOGGER.debug('Could not find ark kernel path; skipping Jupyter kernel setup');
		return;
	}

	// Build environment variables for the kernel spec
	const env: Record<string, string> = {
		RUST_LOG: 'error',
		...getArkEnvironmentVariables(rHomePath)
	};

	LOGGER.debug(`Setting up ark Jupyter kernel with R_HOME=${rHomePath}`);

	// Create kernel.json content
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
		env
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
	// https://docs.jupyter.org/en/stable/use/jupyter-directories.html#envvar-JUPYTER_PATH
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
	collection.replace('JUPYTER_PATH', newJupyterPath, {
		applyAtProcessCreation: true,
		applyAtShellIntegration: true
	});
	LOGGER.debug(`Set JUPYTER_PATH to ${newJupyterPath}`);
}
