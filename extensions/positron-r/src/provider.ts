/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as semver from 'semver';
import * as vscode from 'vscode';
import * as which from 'which';
import * as positron from 'positron';
import * as crypto from 'crypto';

import { RInstallation, RMetadataExtra, getRHomePath, ReasonDiscovered, friendlyReason } from './r-installation';
import { LOGGER } from './extension';
import { EXTENSION_ROOT_DIR, MINIMUM_R_VERSION } from './constants';

// We don't give this a type so it's compatible with both the VS Code
// and the LSP types
export const R_DOCUMENT_SELECTORS = [
	{ language: 'r', scheme: 'untitled' },
	{ language: 'r', scheme: 'inmemory' },  // Console
	{ language: 'r', pattern: '**/*.{r,R}' },
	{ language: 'r', pattern: '**/*.{rprofile,Rprofile}' },
];

export interface RBinary {
	path: string;
	reasons: ReasonDiscovered[]
}

/**
 * The source for the R runtime, in the order that we display these sources in the quick pick.
 */
export enum RRuntimeSource {
	system = 'System',
	user = 'User',
	homebrew = 'Homebrew',
}

/**
 * Discovers R language runtimes for Positron; implements positron.LanguageRuntimeDiscoverer.
 *
 * @param context The extension context.
 */
export async function* rRuntimeDiscoverer(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
	const binaries = new Map<string, RBinary>();

	function updateBinaries(binary: RBinary | RBinary[] | undefined): void {
		if (!binary) {
			return;
		}
		const input = Array.isArray(binary) ? binary : [binary];
		for (const binary of input) {
			if (binaries.has(binary.path)) {
				const reasons = new Set(binaries.get(binary.path)!.reasons.concat(binary.reasons));
				binaries.get(binary.path)!.reasons = Array.from(reasons);
			} else {
				binaries.set(binary.path, binary);
			}
		}
	}

	// Find the current R binary(ies) for various definitions of "current".
	// The first item here will eventually be marked as The Current R Binary.
	const currentBinaries = await currentRBinaryCandidates();
	updateBinaries(currentBinaries);

	// Now we scour the system for all R binaries we can find.
	const systemHqBinaries = discoverHQBinaries(rHeadquarters());
	updateBinaries(systemHqBinaries);

	const registryBinaries = await discoverRegistryBinaries();
	updateBinaries(registryBinaries);

	const moreBinaries = discoverAdHocBinaries([
		'/usr/bin/R',
		'/usr/local/bin/R',
		'/opt/local/bin/R',
		'/opt/homebrew/bin/R'
	]);
	updateBinaries(moreBinaries);

	// Optional, user-specified root directories or binaries
	const userHqBinaries = discoverHQBinaries(userRHeadquarters());
	updateBinaries(userHqBinaries);

	const userMoreBinaries = discoverAdHocBinaries(userRBinaries());
	updateBinaries(userMoreBinaries);

	// (Try to) promote each RBinary to a proper RInstallation
	let rInstallations: Array<RInstallation> = [];
	if (currentBinaries.length > 0) {
		const currentBinary = currentBinaries[0];
		rInstallations.push(new RInstallation(currentBinary.path, true, currentBinary.reasons));
		binaries.delete(currentBinary.path);
	}

	binaries.forEach(rbin => {
		rInstallations.push(new RInstallation(rbin.path, false, rbin.reasons));
	});

	const rejectedRInstallations: Array<RInstallation> = [];
	rInstallations = rInstallations
		.filter(r => {
			if (!r.usable) {
				LOGGER.info(`Filtering out ${r.binpath}, reason: ${friendlyReason(r.reasonRejected)}.`);
				rejectedRInstallations.push(r);
				return false;
			}
			return true;
		});

	if (rejectedRInstallations.length > 0) {
		if (rInstallations.length === 0) {
			LOGGER.warn(`All discovered R installations are unusable by Positron.`);
			LOGGER.warn('Learn more about R discovery at https://positron.posit.co/r-installations');
			const showLog = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t('No usable R installations'),
				vscode.l10n.t('All discovered R installations are unusable by Positron. Learn more about R discovery at <br><a href="https://positron.posit.co/r-installations">https://positron.posit.co/r-installations</a>'),
				vscode.l10n.t('View logs'),
				vscode.l10n.t('Dismiss')
			);
			if (showLog) {
				LOGGER.show();
			}
		} else {
			LOGGER.warn(`Some discovered R installations are unusable by Positron.`);
			LOGGER.warn('Learn more about R discovery at https://positron.posit.co/r-installations');
		}
	}

	rInstallations.sort((a, b) => {
		if (a.current || b.current) {
			// always put the current R version first
			return Number(b.current) - Number(a.current);
		}
		// otherwise, sort by version number, descending
		// break ties by architecture
		// (currently taking advantage of the fact that 'aarch64' > 'x86_64')
		return semver.compare(b.semVersion, a.semVersion) || a.arch.localeCompare(b.arch);
	});

	// For now, we recommend an R runtime for the workspace based on a set of
	// non-runtime-specific heuristics.
	// In the future, we will use more sophisticated heuristics, such as
	// checking an renv lockfile for a match against a system version of R.
	let recommendedForWorkspace = await shouldRecommendForWorkspace();

	for (const rInst of rInstallations) {
		// If we're recommending an R runtime, request immediate startup.
		const startupBehavior = recommendedForWorkspace ?
			positron.LanguageRuntimeStartupBehavior.Immediate :
			positron.LanguageRuntimeStartupBehavior.Implicit;
		// But immediate startup only applies to, at most, one R installation -- specifically, the
		// first element of rInstallations.
		recommendedForWorkspace = false;

		// If there is another R installation with the same version but different architecture,
		// we need to disambiguate the runtime name by appending the architecture.
		// For example, if x86_64 and arm64 versions of R 4.4.0 exist simultaneously.
		let needsArch = false;
		for (const otherRInst of rInstallations) {
			if (rInst.version === otherRInst.version && rInst.arch !== otherRInst.arch) {
				needsArch = true;
				break;
			}
		}

		const metadata = makeMetadata(rInst, startupBehavior, needsArch);

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		yield metadata;
	}
}

export async function makeMetadata(
	rInst: RInstallation,
	startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Implicit,
	includeArch: boolean = false
): Promise<positron.LanguageRuntimeMetadata> {
	// Is the runtime path within the user's home directory?
	const homedir = os.homedir();
	const isUserInstallation = rInst.binpath.startsWith(homedir);

	// Create the runtime path.
	// TODO@softwarenerd - We will need to update this for Windows.
	const runtimePath = os.platform() !== 'win32' && isUserInstallation ?
		path.join('~', rInst.binpath.substring(homedir.length)) :
		rInst.binpath;

	// Does the runtime path have 'homebrew' as a component? (we assume that
	// it's a Homebrew installation if it does)
	const isHomebrewInstallation = rInst.binpath.includes('/homebrew/');

	const runtimeSource = isHomebrewInstallation ? RRuntimeSource.homebrew :
		isUserInstallation ?
			RRuntimeSource.user : RRuntimeSource.system;

	// Short name shown to users (when disambiguating within a language)
	const runtimeShortName = includeArch ? `${rInst.version} (${rInst.arch})` : rInst.version;

	// Full name shown to users
	const runtimeName = `R ${runtimeShortName}`;

	// Get the version of this extension from package.json so we can pass it
	// to the adapter as the implementation version.
	const packageJson = require('../package.json');

	const rVersion = rInst.version;

	// Create a stable ID for the runtime based on the interpreter path and version.
	const digest = crypto.createHash('sha256');
	digest.update(rInst.binpath);
	digest.update(rVersion);
	const runtimeId = digest.digest('hex').substring(0, 32);

	// Save the R home path and binary path as extra data.
	// Also, whether this R installation is the "current" R version.
	const extraRuntimeData: RMetadataExtra = {
		homepath: rInst.homepath,
		binpath: rInst.binpath,
		current: rInst.current,
		reasonDiscovered: rInst.reasonDiscovered,
	};

	// Check the kernel supervisor's configuration; if it's enabled and
	// configured to persist sessions, mark the session location as 'machine'
	// so that Positron will reattach to the session after Positron is reopened.
	const config = vscode.workspace.getConfiguration('kernelSupervisor');
	const sessionLocation = config.get<boolean>('enable', true) &&
		config.get<string>('shutdownTimeout', 'immediately') !== 'immediately' ?
		positron.LanguageRuntimeSessionLocation.Machine : positron.LanguageRuntimeSessionLocation.Workspace;

	const metadata: positron.LanguageRuntimeMetadata = {
		runtimeId,
		runtimeName,
		runtimeShortName,
		runtimePath,
		runtimeVersion: packageJson.version,
		runtimeSource,
		languageId: 'r',
		languageName: 'R',
		languageVersion: rVersion,
		base64EncodedIconSvg:
			fs.readFileSync(
				path.join(EXTENSION_ROOT_DIR, 'resources', 'branding', 'r-icon.svg')
			).toString('base64'),
		sessionLocation,
		startupBehavior,
		extraRuntimeData
	};

	return metadata;
}

// functions relating to the current R binary
let cachedRBinaryCurrent: RBinary | undefined;

export async function currentRBinary(): Promise<RBinary | undefined> {
	if (cachedRBinaryCurrent !== undefined) {
		return cachedRBinaryCurrent;
	}

	const candidates = await currentRBinaryCandidates();
	if (candidates.length === 0) {
		return undefined;
	} else {
		cachedRBinaryCurrent = candidates[0];
		return cachedRBinaryCurrent;
	}
}

async function currentRBinaryCandidates(): Promise<RBinary[]> {
	const candidates: RBinary[] = [];
	let candidate: RBinary | undefined;

	if (os.platform() === 'win32') {
		candidate = await currentRBinaryFromRegistry();
		if (candidate) {
			candidates.push(candidate);
		}
	}

	candidate = await currentRBinaryFromPATH();
	if (candidate) {
		candidates.push(candidate);
	}

	if (os.platform() !== 'win32') {
		candidate = currentRBinaryFromHq(rHeadquarters());
		if (candidate) {
			candidates.push(candidate);
		}
	}

	return candidates;
}

let cachedRBinaryFromRegistry: RBinary | undefined;

async function currentRBinaryFromRegistry(): Promise<RBinary | undefined> {
	if (os.platform() !== 'win32') {
		LOGGER.info('Skipping registry check on non-Windows platform');
		return undefined;
	}

	if (cachedRBinaryFromRegistry !== undefined) {
		return cachedRBinaryFromRegistry;
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	const Registry = await import('@vscode/windows-registry');

	const hives: any[] = ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE'];
	const wows = ['', 'WOW6432Node'];

	let installPath = undefined;

	for (const hive of hives) {
		for (const wow of wows) {
			const R64_KEY: string = `SOFTWARE\\${wow ? wow + '\\' : ''}R-core\\R64`;
			try {
				const key = Registry.GetStringRegKey(hive, R64_KEY, 'InstallPath');
				if (key) {
					installPath = key;
					LOGGER.info(`Registry key ${hive}\\${R64_KEY}\\InstallPath reports the current R installation is at ${key}`);
					break;
				}
			} catch { }
		}
	}

	if (installPath === undefined) {
		LOGGER.info('Cannot determine current version of R from the registry.');
		return undefined;
	}

	const binPath = firstExisting(installPath, binFragments());
	if (!binPath) {
		return undefined;
	}

	LOGGER.info(`Identified the current R binary: ${binPath}`);
	cachedRBinaryFromRegistry = { path: binPath, reasons: [ReasonDiscovered.registry] };
	return cachedRBinaryFromRegistry;
}

let cachedRBinaryFromPATH: RBinary | undefined;

async function currentRBinaryFromPATH(): Promise<RBinary | undefined> {
	if (cachedRBinaryFromPATH !== undefined) {
		return cachedRBinaryFromPATH;
	}

	const whichR = await which('R', { nothrow: true }) as string;
	if (whichR) {
		LOGGER.info(`Possibly found R on PATH: ${whichR}.`);
		if (os.platform() === 'win32') {
			cachedRBinaryFromPATH = await currentRBinaryFromPATHWindows(whichR);
		} else {
			cachedRBinaryFromPATH = await currentRBinaryFromPATHNotWindows(whichR);
		}
	} else {
		cachedRBinaryFromPATH = undefined;
	}

	return cachedRBinaryFromPATH;
}

export async function currentRBinaryFromPATHWindows(whichR: string): Promise<RBinary | undefined> {
	// The CRAN Windows installer does NOT put R on the PATH.
	// If we are here, it is because the user has arranged it so.
	const ext = path.extname(whichR).toLowerCase();
	if (ext !== '.exe') {
		// rig can put put something on the PATH that results in whichR being 'a/path/to/R.bat'
		// but we aren't going to handle that.
		LOGGER.info(`Unsupported extension: ${ext}.`);
		return undefined;
	}

	// Overall idea: a discovered binpath --> homepath --> our preferred binpath
	// This might just be a no-op.
	// But if the input binpath is this:
	// "C:\Program Files\R\R-4.3.2\bin\R.exe"
	// we want to convert it to this, if it exists:
	// "C:\Program Files\R\R-4.3.2\bin\x64\R.exe"
	// It typically does exist for x86_64 R installations.
	// It will not exist for arm64 R installations.
	const whichRHome = getRHomePath(whichR);
	if (!whichRHome) {
		LOGGER.info(`Failed to get R home path from ${whichR}.`);
		return undefined;
	}
	const binpathNormalized = firstExisting(whichRHome, binFragments());
	if (binpathNormalized) {
		LOGGER.info(`Resolved R binary at ${binpathNormalized}.`);
		return { path: binpathNormalized, reasons: [ReasonDiscovered.PATH] };
	} else {
		LOGGER.info(`Can't find R binary within ${whichRHome}.`);
		return undefined;
	}
}

async function currentRBinaryFromPATHNotWindows(whichR: string): Promise<RBinary | undefined> {
	const whichRCanonical = fs.realpathSync(whichR);
	LOGGER.info(`Resolved R binary at ${whichRCanonical}`);
	return { path: whichRCanonical, reasons: [ReasonDiscovered.PATH] };
}

function currentRBinaryFromHq(hqDirs: string[]): RBinary | undefined {
	// this is not relevant on Windows
	if (os.platform() === 'win32') {
		return undefined;
	}

	// and, on not-Windows, hqDirs is expected to be a singleton
	if (hqDirs.length > 1) {
		LOGGER.error('Expected exactly one R HQ directory on this platform.');
	}
	const hqDir = hqDirs[0];

	if (!fs.existsSync(hqDir)) {
		return undefined;
	}

	const currentDirs = fs.readdirSync(hqDir)
		.map(file => path.join(hqDir, file))
		// macOS: 'Current' (uppercase 'C'), if it exists, is a symlink to an actual version
		// linux: 'current' (lowercase 'c'), if it exists, is a symlink to an actual version
		.filter(path => path.toLowerCase().endsWith('current'));

	if (currentDirs.length !== 1) {
		return undefined;
	}
	const currentDir = currentDirs[0];

	const binpath = firstExisting(currentDir, binFragments());
	if (!binpath) {
		return undefined;
	}

	const binary = { path: fs.realpathSync(binpath), reasons: [ReasonDiscovered.HQ] };
	return binary;
}

// Consult various sources of other, perhaps non-current, R binaries
function discoverHQBinaries(hqDirs: string[]): RBinary[] {
	const existingHqDirs = hqDirs.filter(dir => fs.existsSync(dir));
	if (existingHqDirs.length === 0) {
		return [];
	}

	const versionDirs = existingHqDirs
		.map(hqDir => fs.readdirSync(hqDir).map(file => path.join(hqDir, file)))
		// Windows: rig creates 'bin/', which is a directory of .bat files (at least, for now)
		// https://github.com/r-lib/rig/issues/189
		.map(listing => listing.filter(path => !path.endsWith('bin')))
		// macOS: 'Current' (uppercase 'C'), if it exists, is a symlink to an actual version
		// linux: 'current' (lowercase 'c'), if it exists, is a symlink to an actual version
		.map(listing => listing.filter(path => !path.toLowerCase().endsWith('current')));

	// On Windows:
	// In the case that both (1) and (2) exist we prefer (1).
	// (1) C:\Program Files\R\R-4.3.2\bin\x64\R.exe
	// (2) C:\Program Files\R\R-4.3.2\bin\R.exe
	// Because we require R >= 4.2, we don't need to consider bin\i386\R.exe.
	const binaries = versionDirs
		.map(vd => vd.map(x => firstExisting(x, binFragments())))
		.flat()
		// macOS: By default, the CRAN installer deletes previous R installations, but sometimes
		// it doesn't do a thorough job of it and a nearly-empty version directory lingers on.
		.filter(b => fs.existsSync(b))
		.map(b => ({ path: b, reasons: [ReasonDiscovered.HQ] }));
	return binaries;
}

async function discoverRegistryBinaries(): Promise<RBinary[]> {
	if (os.platform() !== 'win32') {
		LOGGER.info('Skipping registry check on non-Windows platform');
		return [];
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	const Registry = await import('@vscode/windows-registry');

	const hives: any[] = ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE'];
	// R's install path is written to a WOW (Windows on Windows) node when e.g. an x86 build of
	// R is installed on an ARM version of Windows.
	const wows = ['', 'WOW6432Node'];

	// The @vscode/windows-registry module is so minimalistic that it can't list the registry.
	// Therefore we explicitly generate the R versions that might be there and check for each one.
	const versions = generateVersions();

	const discoveredKeys: string[] = [];

	for (const hive of hives) {
		for (const wow of wows) {
			for (const version of versions) {
				const R64_KEY: string = `SOFTWARE\\${wow ? wow + '\\' : ''}R-core\\R64\\${version}`;
				try {
					const key = Registry.GetStringRegKey(hive, R64_KEY, 'InstallPath');
					if (key) {
						LOGGER.info(`Registry key ${hive}\\${R64_KEY}\\InstallPath reports an R installation at ${key}`);
						discoveredKeys.push(key);
					}
				} catch { }
			}
		}
	}

	const binPaths = discoveredKeys
		.map(installPath => firstExisting(installPath, binFragments()))
		.filter(binPath => binPath !== undefined)
		.map(binPath => ({ path: binPath, reasons: [ReasonDiscovered.registry] }));

	return binPaths;
}

function discoverAdHocBinaries(paths: string[]): RBinary[] {
	return paths
		.filter(b => fs.existsSync(b))
		.map(b => fs.realpathSync(b))
		.map(b => ({ path: b, reasons: [ReasonDiscovered.adHoc] }));
}

// R discovery helpers

// directory(ies) where this OS is known to keep its R installations
function rHeadquarters(): string[] {
	switch (process.platform) {
		case 'darwin':
			return [path.join('/Library', 'Frameworks', 'R.framework', 'Versions')];
		case 'linux':
			return [path.join('/opt', 'R')];
		case 'win32': {
			const paths = [
				path.join(process.env['ProgramW6432'] || 'C:\\Program Files', 'R')
			];
			if (process.env['LOCALAPPDATA']) {
				paths.push(path.join(process.env['LOCALAPPDATA'], 'Programs', 'R'));
			}
			return [...new Set(paths)];
		}
		default:
			throw new Error('Unsupported platform');
	}
}

// directory(ies) where this user keeps R installations
function userRHeadquarters(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const userHqDirs = config.get<string[]>('customRootFolders');
	if (userHqDirs && userHqDirs.length > 0) {
		const formattedPaths = JSON.stringify(userHqDirs, null, 2);
		LOGGER.info(`User-specified directories to scan for R installations:\n${formattedPaths}`);
		return userHqDirs;
	} else {
		return [];
	}
}

// ad hoc binaries this user wants Positron to know about
function userRBinaries(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const userBinaries = config.get<string[]>('customBinaries');
	if (userBinaries && userBinaries.length > 0) {
		const formattedPaths = JSON.stringify(userBinaries, null, 2);
		LOGGER.info(`User-specified R binaries:\n${formattedPaths}`);
		return userBinaries;
	} else {
		return [];
	}
}

function firstExisting(base: string, fragments: string[]): string {
	const potentialPaths = fragments.map(f => path.join(base, f));
	const existingPath = potentialPaths.find(p => fs.existsSync(p));
	return existingPath || '';
}

function binFragments(): string[] {
	switch (process.platform) {
		case 'darwin':
			return [path.join('Resources', 'bin', 'R')];
		case 'linux':
			return [path.join('bin', 'R')];
		case 'win32':
			return [
				path.join('bin', 'x64', 'R.exe'),
				path.join('bin', 'R.exe')
			];
		default:
			throw new Error('Unsupported platform');
	}
}

/**
 * Generates all possible R versions that we might find recorded in the Windows registry.
 * Sort of.
 * Only considers the major version of Positron's current minimum R version and that major
 * version plus one.
 * Naively tacks " Pre-release" onto each version numbers, because that's how r-devel shows up.
*/
function generateVersions(): string[] {
	const minimumSupportedVersion = semver.coerce(MINIMUM_R_VERSION)!;
	const major = minimumSupportedVersion.major;
	const minor = minimumSupportedVersion.minor;
	const patch = minimumSupportedVersion.patch;

	const versions: string[] = [];
	for (let x = major; x <= major + 1; x++) {
		for (let y = (x === major ? minor : 0); y <= 9; y++) {
			for (let z = (x === major && y === minor ? patch : 0); z <= 9; z++) {
				versions.push(`${x}.${y}.${z}`);
				versions.push(`${x}.${y}.${z} Pre-release`);
			}
		}
	}

	return versions;
}


// Should we recommend an R runtime for the workspace?
async function shouldRecommendForWorkspace(): Promise<boolean> {
	// Check if the workspace contains R-related files.
	const globs = [
		'**/*.R',
		'**/*.Rmd',
		'.Rprofile',
		'renv.lock',
		'.Rbuildignore',
		'.Renviron',
		'*.Rproj'
	];
	// Convert to the glob format used by vscode.workspace.findFiles.
	const glob = `{${globs.join(',')}}`;
	if (await hasFiles(glob)) {
		return true;
	}

	// Check if the workspace is empty and the user is an RStudio user.
	if (!(await hasFiles('**/*')) && isRStudioUser()) {
		return true;
	}

	return false;
}

// Check if the current workspace contains files matching a glob pattern.
async function hasFiles(glob: string): Promise<boolean> {
	// Exclude node_modules for performance reasons
	return (await vscode.workspace.findFiles(glob, '**/node_modules/**', 1)).length > 0;
}

/**
 * Attempts to heuristically determine if the user is an RStudio user by
 * checking for recently modified files in RStudio's state directory.
 *
 * @returns true if the user is an RStudio user, false otherwise
 */
function isRStudioUser(): boolean {
	try {
		const filenames = fs.readdirSync(rstudioStateFolderPath());
		const today = new Date();
		const thirtyDaysAgo = new Date(new Date().setDate(today.getDate() - 30));
		const isRecentlyModified = filenames.some(file => {
			const stats = fs.statSync(rstudioStateFolderPath(file));
			return stats.mtime > thirtyDaysAgo;
		});
		return isRecentlyModified;
	} catch { }
	return false;
}

/**
 * Returns the path to RStudio's state folder directory. Currently checks only the default for each
 * OS. A more earnest effort would require fully implementing the logic in RStudio's `userDataDir()`
 * functions (there are implementations in both C++ and Typescript). That would add logic to
 * check the variables RSTUDIO_DATA_HOME and XDG_DATA_HOME.
 *
 * @param pathToAppend The path to append, if any
 * @returns The path to RStudio's state folder directory.
 */
function rstudioStateFolderPath(pathToAppend = ''): string {
	let newPath: string;
	switch (process.platform) {
		case 'darwin':
		case 'linux':
			newPath = path.join(process.env.HOME!, '.local/share/rstudio', pathToAppend);
			break;
		case 'win32':
			newPath = path.join(process.env.LOCALAPPDATA!, 'RStudio', pathToAppend);
			break;
		default:
			throw new Error('Unsupported platform');
	}
	return newPath;
}
