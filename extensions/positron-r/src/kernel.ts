/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';

import { withActiveExtension, delay } from './util';
import { RRuntime } from './runtime';
import { JupyterKernelSpec, JupyterKernelExtra } from './jupyter-adapter';

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let runtime: positron.LanguageRuntime;

// macOS
const R_ROOT: string = '/Library/Frameworks/R.framework/Versions';
const R_BINPATH: string = '{}/Resources/R';

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

// ALTERNATIVE: we could grab the R version from the DESCRIPTION file of base
function getRVersion(rHome: string): string {
	// Get the version of the R installation
	const { execSync } = require('child_process');
	let rVersion = '';
	try {
		rVersion = execSync(
			`${rHome}/bin/R --vanilla -s -e 'cat(R.Version()$major,R.Version()$minor, sep=".")'`,
			{ shell: '/bin/bash', encoding: 'utf8' })
			.trim();
	} catch (e) {
		console.error(`Error getting R version: for ${rHome}: ${e}`);
	}
	return rVersion;
}

// ALTERNATIVE: we can learn this by reading the first beginning byte of the R binary
function getRHOME(rHome: string): string {
	const { execSync } = require('child_process');
	const binPath = rHome === '' ? 'R' : `${rHome}/R`;
	let RHOME = '';
	try {
		RHOME = execSync(
			`${binPath} RHOME`, { shell: '/bin/bash', encoding: 'utf8' }).trim();
	} catch (e) {
		console.error(`Error running R RHOME command for ${rHome}: ${e}`);
	}
	return RHOME;
}

// input: '4.3-arm64'
// output: '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/bin/R'
function getRBinary(version: string): string {
	return path.join(R_ROOT, R_BINPATH.replace('{}', version));
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): void {

	class RInstallation {
		public readonly rHome: string;        // `path` in rig
		public readonly rHomeAsFound: string; // no equivalent in rig
		public readonly rHomeRHOME: string;   // no equivalent in rig
		public readonly rVersion: string;     // `version` in rig

		/**
		 * Represents an installation of R on the user's system.
		 *
		 * @param pth Candidate path for an R home folder
		 */
		constructor(pth: string) {
			this.rHomeAsFound = pth;
			this.rHome = fs.realpathSync(pth);
			this.rHomeRHOME = getRHOME(pth);
			this.rVersion = getRVersion(this.rHome);
			// TODO: we should also record the architecture
			// e.g. distinguish between 4.3-arm64 vs. 4.3-x86_64
		}

		is_orthogonal() {
			return fs.realpathSync(this.rHomeRHOME) === this.rHome;
		}
	}

	const rInstallations: Array<RInstallation> = [];

	const { execSync } = require('child_process');

	// Check the R kernel log level setting
	const config = vscode.workspace.getConfiguration('positron.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';

	// Discover R installations.
	// TODO: Needs to handle Linux and Windows. See e.g. how Quarto handles this:
	// https://github.com/quarto-dev/quarto-cli/blob/main/src/core/resources.ts#L77
	//
	// TODO: Needs to handle other installation locations (like RSwitch)

	// Check the R Versions folder on macOS. Typically, this only contains one
	// version of R, but it's possible to have multiple versions installed in
	// cases where a third-party utility such as `rig` is used to manage R
	// installations.
	const versionDirs = fs.readdirSync(R_ROOT)
		// 'Current', if it exists, is a symlink to an actual version. Skip it here to avoid
		// redundant entries.
		.filter(v => v !== 'Current')
		// Check for an R binary in the expected place
		.filter(v => fs.existsSync(getRBinary(v)));

	versionDirs
		.forEach((version: string) => {
			const pth = path.join(R_ROOT, version, 'Resources');
			rInstallations.push(new RInstallation(pth));
		});
	// TODO: see Google Doc about multiple R versions for things we could do in the future
	// re: non-orthogonal R installations
	rInstallations.filter(inst => inst.is_orthogonal());

	// Sort the R installations by version number, descending. If we don't find an R
	// installation on the PATH, this produces reasonable default behaviour, which is to
	// prefer the most recent version of R, if there are multiple versions installed.
	// TODO: Once we record architecture, put, e.g., 4.3-arm64 before 4.3-x86_64.
	rInstallations.sort((a, b) => {
		return b.rVersion.localeCompare(a.rVersion);
	});

	// Look for an R installation on the PATH. If found, make sure it's at the front of
	// the list.
	const rPATH = getRHOME('');
	if (rPATH !== '') {
		const rHome = fs.realpathSync(rPATH);
		if (fs.existsSync(rHome)) {
			const loc = rInstallations.findIndex(r => r.rHome === rHome);
			if (loc < 0) {
				// add it to the front
				// TODO: do we care about making a second call to getRHOME() here?
				rInstallations.unshift(new RInstallation(rHome));
			} else if (loc > 0) {
				// move it to the front
				rInstallations.splice(0, 0, rInstallations.splice(loc, 1)[0]);
			} // it was already at the front
		}
	}

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
			'R_HOME': rHome.rHome,
			'R_CLI_NUM_COLORS': '256',
		};
		/* eslint-enable */

		if (process.platform === 'darwin') {

			const dyldFallbackLibraryPaths: string[] = [];
			dyldFallbackLibraryPaths.push(`${rHome.rHome}/lib`);

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
		const isUserInstallation = rHome.rHome.startsWith(homedir);

		// Create the runtime path.
		// TODO@softwarenerd - We will need to update this for Windows.
		const runtimePath = os.platform() !== 'win32' && isUserInstallation ?
			path.join('~', rHome.rHome.substring(homedir.length)) :
			rHome.rHome;

		// Does the runtime path have 'homebrew' as a component? (we assume that
		// it's a Homebrew installation if it does)
		const isHomebrewInstallation = rHome.rHome.includes('/homebrew/');

		const runtimeSource = isHomebrewInstallation ? 'Homebrew' :
			isUserInstallation ?
				'User' : 'System';

		// Create a kernel spec for this R installation
		const kernelSpec: JupyterKernelSpec = {
			'argv': [
				kernelPath,
				'--connection_file', '{connection_file}',
				'--log', '{log_file}'
			],
			'display_name': `R (${runtimeSource})`, // eslint-disable-line
			'language': 'R',
			'env': env,
		};

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const rVersion = rHome.rVersion ?? '0.0.1';

		// Create a stable ID for the runtime based on the interpreter path and version.
		const digest = crypto.createHash('sha256');
		digest.update(JSON.stringify(kernelSpec));
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
			inputPrompt: '>',
			continuationPrompt: '+',
			base64EncodedIconSvg:
				fs.readFileSync(
					path.join(context.extensionPath, 'resources', 'branding', 'r-icon.svg')
				).toString('base64'),
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit
		};

		const extra: JupyterKernelExtra = {
			attachOnStartup: new ArkAttachOnStartup(),
			sleepOnStartup: new ArkDelayStartup(),
		};

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		runtime = new RRuntime(context, kernelSpec, metadata, ext.exports, extra);
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
