/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as semver from 'semver';
import * as which from 'which';

import { withActiveExtension, delay } from './util';
import { RRuntime } from './runtime';
import { JupyterKernelSpec, JupyterKernelExtra } from './jupyter-adapter';
import { RInstallation } from './r-installation';

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let runtime: positron.LanguageRuntime;

export function adaptJupyterKernel(context: vscode.ExtensionContext, kernelPath: string) {
	// Check to see whether the Jupyter Adapter extension is installed
	// and active. If so, we can start the language server.
	const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
	if (!ext) {
		vscode.window.showErrorMessage(`Could not find Jupyter Adapter extension; can't register ARK.`);
		return;
	}

	// We have a kernel path; use the VS Code file system API to see if it exists on disk.
	const fs = require('fs');
	if (!fs.existsSync(kernelPath)) {
		vscode.window.showErrorMessage(`ARK kernel path doesn't exist: ${kernelPath}`);
		return;
	}

	withActiveExtension(ext, () => {
		registerArkKernel(ext!, context, kernelPath as string);
	});
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

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): void {

	// Check the R kernel log level setting
	const config = vscode.workspace.getConfiguration('positron.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';

	const binaries = new Set<string>();
	let rInstallations: Array<RInstallation> = [];

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
	const whichR = which.sync('R', { nothrow: true }) as string;
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
			'R_HOME': rHome.homepath,
			'R_CLI_NUM_COLORS': '256',
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

		// Create a kernel spec for this R installation
		const kernelSpec: JupyterKernelSpec = {
			'argv': [
				kernelPath,
				'--connection_file', '{connection_file}',
				'--log', '{log_file}',
				// The arguments after `--` are passed verbatim to R
				'--',
				'--interactive',
			],
			'display_name': `R (${runtimeSource})`, // eslint-disable-line
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

		const metadata: positron.LanguageRuntimeMetadata = {
			runtimeId,
			runtimeName: kernelSpec.display_name,
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
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit
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
		runtime = new RRuntime(context, kernelSpec, metadata, dynState, ext.exports, extra);
		context.subscriptions.push(runtime);

		// Register the language runtime with Positron.
		const disposable = positron.runtime.registerLanguageRuntime(runtime);
		context.subscriptions.push(disposable);
	}
}

class ArkAttachOnStartup {
	_delayDir?: string;
	_delayFile?: string;

	// Add `--startup-notifier-file` argument to pass a notification file
	// that triggers the actual startup of the kernel
	init(args: Array<String>) {
		this._delayDir = fs.mkdtempSync(`${os.tmpdir()}-JupyterDelayStartup`);
		this._delayFile = path.join(this._delayDir, 'file');

		fs.writeFileSync(this._delayFile!, 'create\n');

		args.push('--startup-notifier-file');
		args.push(this._delayFile);
	}

	// This is paired with `init()` and disposes of created resources
	async attach() {
		// Run <f5>
		await vscode.commands.executeCommand('workbench.action.debug.start');

		// Notify the kernel it can now start up
		fs.writeFileSync(this._delayFile!, 'go\n');

		// Give some time before removing the file, no need to await
		delay(100).then(() => {
			fs.rmSync(this._delayDir!, { recursive: true, force: true });
		});
	}
}

class ArkDelayStartup {
	// Add `--startup-delay` argument to pass a delay in
	// seconds before starting up the kernel
	init(args: Array<String>, delay: number) {
		args.push('--startup-delay');
		args.push(delay.toString());
	}
}
