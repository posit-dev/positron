/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as semver from 'semver';
import * as vscode from 'vscode';
import * as which from 'which';
import * as positron from 'positron';
import * as crypto from 'crypto';

import { RInstallation, getRHomePath } from './r-installation';
import { RRuntime, createJupyterKernelExtra, createJupyterKernelSpec } from './runtime';
import { RRuntimeManager } from './runtime-manager';

const initialDynState = {
	inputPrompt: '>',
	continuationPrompt: '+',
} as positron.LanguageRuntimeDynState;

/**
 * Provides a single R language runtime for Positron; implements
 * positron.LanguageRuntimeProvider.
 *
 * @param context The extension context.
 */
export class RRuntimeProvider implements positron.LanguageRuntimeProvider {

	/**
	 * Constructor.
	 * @param context The extension context.
	 */
	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	async provideLanguageRuntime(runtimeMetadata: positron.LanguageRuntimeMetadata, token: vscode.CancellationToken): Promise<positron.LanguageRuntime> {

		const rHomePath = getRHomePath(runtimeMetadata.runtimePath);
		if (!rHomePath) {
			throw new Error(`Cannot find R_HOME for ${runtimeMetadata.runtimePath}`);
		}
		const kernelSpec = createJupyterKernelSpec(this.context,
			rHomePath,
			runtimeMetadata.runtimeName);

		const extra = createJupyterKernelExtra();

		// Use existing runtime if it present.
		if (RRuntimeManager.instance.hasRuntime(runtimeMetadata.runtimeId)) {
			return RRuntimeManager.instance.getRuntime(runtimeMetadata.runtimeId);
		}

		// No existing runtime with this ID; create a new one.
		const runtime = new RRuntime(this.context, kernelSpec, runtimeMetadata,
			initialDynState, extra);
		RRuntimeManager.instance.setRuntime(runtimeMetadata.runtimeId, runtime);
		return runtime;
	}
}

/**
 * Discovers R language runtimes for Positron; implements
 * positron.LanguageRuntimeDiscoverer.
 *
 * @param context The extension context.
 */
export async function* rRuntimeDiscoverer(
	context: vscode.ExtensionContext
): AsyncGenerator<positron.LanguageRuntime> {
	let rInstallations: Array<RInstallation> = [];
	const binaries = new Set<string>();

	// look in the well-known place for R installations on this OS
	const rHq = rHeadquarters();
	if (fs.existsSync(rHq)) {
		const versionBinaries = fs.readdirSync(rHq)
			// 'Current', if it exists, is a symlink to an actual version. Skip it here to avoid
			// redundant entries. This is a macOS phenomenon.
			.filter(v => v !== 'Current')
			.map(v => path.join(rHq, binFragment(v)))
			// By default, macOS CRAN installer deletes previous R installations, but sometimes
			// it doesn't do a thorough job of it and a nearly-empty version directory lingers on.
			.filter(b => fs.existsSync(b));
		for (const b of versionBinaries) {
			binaries.add(b);
		}
	}

	// other places we might find an R binary
	const possibleBinaries = [
		'/usr/bin/R',
		'/usr/local/bin/R',
		'/opt/local/bin/R',
		'/opt/homebrew/bin/R'
	];
	const moreBinaries = possibleBinaries
		.filter(b => fs.existsSync(b))
		.map(b => fs.realpathSync(b));
	for (const b of moreBinaries) {
		binaries.add(b);
	}

	// TODO: Windows
	// On Windows this finds `C:\Program Files\R\bin\R.BAT`, a batch file that starts
	// the underlying version of R, i.e. try right clicking and editing the batch file to see the
	// underlying path it ends up using. We will need some way to associate this with the `R.exe`
	// file it ends up starting.
	if (os.platform() !== 'win32') {
		// make sure we include R executable found on the PATH
		// we've probably already discovered it, but we still need to single it out, so that we mark
		// that particular R installation as the current one
		const whichR = await which('R', { nothrow: true }) as string;
		if (whichR) {
			const whichRCanonical = fs.realpathSync(whichR);
			rInstallations.push(new RInstallation(whichRCanonical, true));
			binaries.delete(whichRCanonical);
		}
	}

	binaries.forEach((b: string) => {
		rInstallations.push(new RInstallation(b));
	});

	// TODO: possible future intervention re: non-orthogonal R installations
	// * Alert the user they have R more installations?
	// * Offer to make installations orthogonal?
	// * Offer to switch the current version of R?
	// for now, we drop non-orthogonal, not-current R installations
	// NOTE: this is also where we drop potential R installations that do not pass validity checks
	rInstallations = rInstallations.filter(r => r.valid && (r.current || r.orthogonal));

	// FIXME? should I explicitly check that there is <= 1 R installation
	// marked as 'current'?

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

	// For now, we recommend the first R runtime for the workspace based on a set of
	// non-runtime-specific heuristics.
	// In the future, we will use more sophisticated heuristics, such as
	// checking an renv lockfile for a match against a system version of R.
	let recommendedForWorkspace = await shouldRecommendForWorkspace();

	// Loop over the R installations and create a language runtime for each one.
	for (const rInst of rInstallations) {

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

		const runtimeSource = isHomebrewInstallation ? 'Homebrew' :
			isUserInstallation ?
				'User' : 'System';

		// Short name shown to users (when disambiguating within a language)
		let runtimeShortName = rInst.version;

		// If there is another R installation with the same version but different architecture,
		// then disambiguate by appending the architecture to the runtime name.
		// For example, if x86_64 and arm64 versions of R 4.4.0 exist simultaneously.
		for (const otherRInst of rInstallations) {
			if (rInst.version === otherRInst.version && rInst.arch !== otherRInst.arch) {
				runtimeShortName = `${runtimeShortName} (${rInst.arch})`;
				break;
			}
		}

		// Full name shown to users
		const runtimeName = `R ${runtimeShortName}`;

		const kernelSpec = createJupyterKernelSpec(context,
			rInst.homepath,
			runtimeName);

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const rVersion = rInst.version;

		// Create a stable ID for the runtime based on the interpreter path and version.
		const digest = crypto.createHash('sha256');
		digest.update(rInst.binpath);
		digest.update(rVersion);
		const runtimeId = digest.digest('hex').substring(0, 32);

		// If we already know about the runtime, return it. This can happen if
		// the runtime was provided eagerly to Positron.
		if (RRuntimeManager.instance.hasRuntime(runtimeId)) {
			yield RRuntimeManager.instance.getRuntime(runtimeId);
			continue;
		}

		// Define the startup behavior; request immediate startup if this is the
		// recommended runtime for the workspace.
		const startupBehavior = recommendedForWorkspace ?
			positron.LanguageRuntimeStartupBehavior.Immediate :
			positron.LanguageRuntimeStartupBehavior.Implicit;

		// Ensure we only recommend one runtime for the workspace.
		recommendedForWorkspace = false;

		const metadata: positron.LanguageRuntimeMetadata = {
			runtimeId,
			runtimeName,
			runtimeShortName,
			runtimePath,
			runtimeVersion: packageJson.version,
			runtimeSource,
			languageId: 'r',
			languageName: kernelSpec.language,
			languageVersion: rVersion,
			base64EncodedIconSvg:
				fs.readFileSync(
					path.join(context.extensionPath, 'resources', 'branding', 'r-icon.svg')
				).toString('base64'),
			startupBehavior
		};

		const extra = createJupyterKernelExtra();

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		const runtime = new RRuntime(context, kernelSpec, metadata, initialDynState, extra);
		RRuntimeManager.instance.setRuntime(metadata.runtimeId, runtime);
		yield runtime;
	}
}

// directory where this OS is known to keep its R installations
function rHeadquarters(): string {
	switch (process.platform) {
		case 'darwin':
			return path.join('/Library', 'Frameworks', 'R.framework', 'Versions');
		case 'linux':
			return path.join('/opt', 'R');
		case 'win32':
			return path.join('C:\\', 'Program Files', 'R');
		default:
			throw new Error('Unsupported platform');
	}
}

function binFragment(version: string): string {
	switch (process.platform) {
		case 'darwin':
			return path.join(version, 'Resources', 'bin', 'R');
		case 'linux':
			return path.join(version, 'bin', 'R');
		case 'win32':
			return path.join(version, 'bin', 'R.exe');
		default:
			throw new Error('Unsupported platform');
	}
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
		const recentlyModified = new Array<boolean>();
		filenames.forEach(file => {
			const stats = fs.statSync(rstudioStateFolderPath(file));
			recentlyModified.push(stats.mtime > thirtyDaysAgo);
		});
		return recentlyModified.some(bool => bool === true);
	} catch { }
	return false;
}

/**
 * Returns the path to RStudio's state folder directory. Doesn't currently work
 * on Windows; see XDG specification for the correct path there.
 *
 * @param pathToAppend The path to append, if any
 * @returns The path to RStudio's state folder directory.
 */
function rstudioStateFolderPath(pathToAppend = ''): string {
	// TODO: Windows
	const newPath = path.join(process.env.HOME!, '.local/share/rstudio', pathToAppend);
	return newPath;
}
