/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as semver from 'semver';
import * as vscode from 'vscode';
import * as which from 'which';
import * as positron from 'positron';
import * as crypto from 'crypto';

import { RInstallation } from './r-installation';
import { RRuntime } from './runtime';
import { JupyterKernelSpec, JupyterKernelExtra } from './jupyter-adapter';
import { ArkAttachOnStartup, ArkDelayStartup } from './startup';
import { getArkKernelPath } from './kernel';

/**
 * Provides R language runtimes to Positron; implements
 * positron.LanguageRuntimeProvider.
 *
 * @param context The extension context.
 */
export async function* rRuntimeProvider(
	context: vscode.ExtensionContext,
	runtimes: Map<string, RRuntime>
): AsyncGenerator<positron.LanguageRuntime> {
	let rInstallations: Array<RInstallation> = [];

	// Path to the kernel executable
	const kernelPath = getArkKernelPath(context);
	if (!kernelPath) {
		throw new Error('Unable to find R kernel');
	}

	// Check the R kernel log level setting
	const config = vscode.workspace.getConfiguration('positron.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';

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

	// make sure we include R executable found on the PATH
	// we've probably already discovered it, but we still need to single it out, so that we mark
	// that particular R installation as the current one
	const whichR = await which('R', { nothrow: true }) as string;
	if (whichR) {
		const whichRCanonical = fs.realpathSync(whichR);
		rInstallations.push(new RInstallation(whichRCanonical, true));
		binaries.delete(whichRCanonical);
	}

	binaries.forEach((b: string) => {
		rInstallations.push(new RInstallation(b));
	});

	// TODO: possible future intervention re: non-orthogonal R installations
	// * Alert the user they have R more installations?
	// * Offer to make installations orthogonal?
	// * Offer to switch the current version of R?
	// for now, we drop non-orthogonal, not-current R installations
	rInstallations = rInstallations.filter(r => r.current || r.orthogonal);

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
	//
	// NOTE(Kevin): We previously set DYLD_INSERT_LIBRARIES here, but this appeared
	// to cause issues when running 'ark' through wrapper scripts in some cases.
	// It's not entirely clear, but it looks like (at least on Kevin's machine)
	// we end up with an x86 shell, inside which we attempt to insert an arm64
	// library, and this ends up causing failure to start at all.
	//
	// See:
	//
	//     ./positron/extensions/jupyter-adapter/resources/kernel-wrapper.sh
	//
	// and its usages for more details.
	//
	// Given that DYLD_FALLBACK_LIBRARY_PATH works fine, we just set that below.
	for (const rHome of rInstallations) {

		/* eslint-disable */
		const env = <Record<string, string>>{
			'RUST_BACKTRACE': '1',
			'RUST_LOG': logLevel,
			'R_HOME': rHome.homepath
		};
		/* eslint-enable */

		if (process.platform === 'darwin') {

			const dyldFallbackLibraryPaths: string[] = [];
			dyldFallbackLibraryPaths.push(`${rHome.homepath}/lib`);

			const defaultDyldFallbackLibraryPath = process.env['DYLD_FALLBACK_LIBRARY_PATH'];
			if (defaultDyldFallbackLibraryPath) {
				dyldFallbackLibraryPaths.push(defaultDyldFallbackLibraryPath);
			}

			// Set the DYLD_FALLBACK_LIBRARY_PATH to include the R installation.
			// This specific environment variable can be blocked from being
			// inherited by child processes on macOS with SIP enabled, so we
			// prefix it with 'POSITRON_' here. The script that starts the
			// kernel will check for this variable and set it as
			// DYLD_FALLBACK_LIBRARY_PATH if it's present.
			env['POSITRON_DYLD_FALLBACK_LIBRARY_PATH'] = dyldFallbackLibraryPaths.join(':');

		}

		// Is the runtime path within the user's home directory?
		const homedir = os.homedir();
		const isUserInstallation = rHome.homepath.startsWith(homedir);

		// Create the runtime path.
		// TODO@softwarenerd - We will need to update this for Windows.
		const runtimePath = os.platform() !== 'win32' && isUserInstallation ?
			path.join('~', rHome.homepath.substring(homedir.length)) :
			rHome.homepath;

		// Does the runtime path have 'homebrew' as a component? (we assume that
		// it's a Homebrew installation if it does)
		const isHomebrewInstallation = rHome.homepath.includes('/homebrew/');

		const runtimeSource = isHomebrewInstallation ? 'Homebrew' :
			isUserInstallation ?
				'User' : 'System';

		// Short name shown to users (when disambiguating within a language)
		let runtimeShortName = rHome.version;

		// If there is another R installation with the same version but different architecture,
		// then disambiguate by appending the architecture to the runtime name.
		// For example, if x86_64 and arm64 versions of R 4.4.0 exist simultaneously.
		for (const otherRHome of rInstallations) {
			if (rHome.version === otherRHome.version && rHome.arch !== otherRHome.arch) {
				runtimeShortName = `${runtimeShortName} (${rHome.arch})`;
				break;
			}
		}

		// Full name shown to users
		const runtimeName = `R ${runtimeShortName}`;

		// R script to run on session startup
		const startupFile = path.join(context.extensionPath, 'resources', 'scripts', 'startup.R');

		// Create a kernel spec for this R installation
		const kernelSpec: JupyterKernelSpec = {
			'argv': [
				kernelPath,
				'--connection_file', '{connection_file}',
				'--log', '{log_file}',
				'--startup-file', `${startupFile}`,
				// The arguments after `--` are passed verbatim to R
				'--',
				'--interactive',
			],
			'display_name': runtimeName, // eslint-disable-line
			'language': 'R',
			'env': env,
		};

		// Unless the user has chosen to restore the workspace, pass the
		// `--no-restore-data` flag to R.
		if (!config.get<boolean>('restoreWorkspace')) {
			kernelSpec.argv.push('--no-restore-data');
		}

		// If the user has supplied extra arguments to R, pass them along.
		const extraArgs = config.get<Array<string>>('extraArguments');
		if (extraArgs) {
			kernelSpec.argv.push(...extraArgs);
		}

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const rVersion = rHome.version;

		// Create a stable ID for the runtime based on the interpreter path and version.
		const digest = crypto.createHash('sha256');
		digest.update(rHome.homepath);
		digest.update(rVersion);
		const runtimeId = digest.digest('hex').substring(0, 32);

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

		const dynState: positron.LanguageRuntimeDynState = {
			inputPrompt: '>',
			continuationPrompt: '+',
		};

		const extra: JupyterKernelExtra = {
			attachOnStartup: new ArkAttachOnStartup(),
			sleepOnStartup: new ArkDelayStartup(),
		};

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		const runtime = new RRuntime(context, kernelSpec, metadata, dynState, extra);
		yield runtime;
		runtimes.set(runtimeId, runtime);
	}
}

// directory where this OS is known to keep its R installations
function rHeadquarters(): string {
	switch (process.platform) {
		case 'darwin':
			return '/Library/Frameworks/R.framework/Versions';
		case 'linux':
			return '/opt/R';
		default:
			// TODO: handle Windows
			throw new Error('Unsupported platform');
	}
}

function binFragment(version: string): string {
	switch (process.platform) {
		case 'darwin':
			return `${version}/Resources/bin/R`;
		case 'linux':
			return `${version}/bin/R`;
		default:
			// TODO: handle Windows
			throw new Error('Unsupported platform');
	}
}

// Should we recommend an R runtime for the workspace?
async function shouldRecommendForWorkspace(): Promise<boolean> {
	// Check if the workspace contains R-related files.
	const globs = [
		'**/*.R',
		'**/*.Rmd',
		'**/.Rprofile',
		'**/renv.lock',
		'**/.Rbuildignore',
		'**/.Renviron',
		'**/*.Rproj'
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
	const newPath = path.join(process.env.HOME!, '.local/share/rstudio', pathToAppend);
	return newPath;
}
