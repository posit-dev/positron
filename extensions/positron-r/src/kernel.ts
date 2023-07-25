/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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

function readLines(pth: string): Array<string> {
	const bigString = fs.readFileSync(pth, 'utf8');
	return bigString.split(/\r?\n/);
}

// extractValue('KEY=VALUE', 'KEY')      --> 'VALUE'
// extractValue('KEY:VALUE', 'KEY', ':') --> 'VALUE'
// extractValue('KEE:VALUE', 'KEY')      --> ''
function extractValue(str: string, key: string, delim: string = '='): string {
	const re = `${key}${delim}(.*)`;
	if (!str.startsWith(key)) {
		return '';
	}
	const m = str.match(re);
	return m?.[1] ?? '';
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): void {

	class RInstallation {
		public readonly binpath: string = '';
		public readonly homepath: string = '';
		// The semVersion field was added because changing the version field from a string that's
		// "major.minor" to an instance of SemVer (conveying major.minor.patch) would have
		// downstream consequence I don't want to take on now. But we can probably rationalize this
		// in the future.
		public readonly semVersion: semver.SemVer = new semver.SemVer('0.0.1');
		public readonly version: string = '';
		public readonly arch: string = '';
		public readonly current: boolean = false;
		public readonly orthogonal: boolean = false;

		/**
		 * Represents an installation of R on the user's system.
		 *
		 * @param pth Filepath for an R "binary" (on macOS and linux, this is actually a
		 *   shell script)
		 */
		constructor(pth: string, current: boolean = false) {
			this.binpath = pth;
			this.current = current;

			const binLines = readLines(this.binpath);
			const re = new RegExp('Shell wrapper for R executable');
			if (!binLines.some(x => re.test(x))) {
				return;
			}
			const targetLine = binLines.find(line => line.match('R_HOME_DIR'));
			if (!targetLine) {
				return;
			}
			// macOS: R_HOME_DIR=/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources
			// macOS non-orthogonal: R_HOME_DIR=/Library/Frameworks/R.framework/Resources
			// linux: R_HOME_DIR=/opt/R/4.2.3/lib/R
			const R_HOME_DIR = extractValue(targetLine, 'R_HOME_DIR');
			this.homepath = R_HOME_DIR;
			if (this.homepath === '') {
				return;
			}

			// orthogonality is a concern specific to macOS
			// a non-orthogonal R "binary" is hard-wired to launch the current version of R,
			// so it only works when it actually is the current version of R
			// learn more in https://github.com/r-lib/rig/blob/main/src/macos.rs
			// see is_orthogonal(), make_orthogonal_()
			const re2 = new RegExp('R[.]framework/Resources');
			this.orthogonal = !re2.test(this.homepath);

			// make sure to target a base package that contains compiled code, so the
			// 'Built' field contains the platform info
			const descPath = path.join(this.homepath, 'library', 'utils', 'DESCRIPTION');
			const descLines = readLines(descPath);
			const targetLine2 = descLines.filter(line => line.match('Built'))[0];
			if (!targetLine2) {
				return;
			}
			// macOS arm64: Built: R 4.3.1; aarch64-apple-darwin20; 2023-06-16 21:52:54 UTC; unix
			// macOS intel: Built: R 4.3.1; x86_64-apple-darwin20; 2023-06-16 21:51:34 UTC; unix
			// linux: Built: R 4.2.3; x86_64-pc-linux-gnu; 2023-03-15 09:03:13 UTC; unix
			const builtField = extractValue(targetLine2, 'Built', ':');
			const builtParts = builtField.split(new RegExp(';\\s+'));

			const versionPart = builtParts[0];
			this.semVersion = semver.coerce(versionPart) ?? new semver.SemVer('0.0.1');
			this.version = `${semver.major(this.semVersion)}.${semver.minor(this.semVersion)}`;

			const platformPart = builtParts[1];
			const architecture = platformPart.match('^(aarch64|x86_64)');
			this.arch = architecture ? architecture[1] : '';
		}
	}

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
				'--log', '{log_file}'
			],
			'display_name': `R (${runtimeSource})`, // eslint-disable-line
			'language': 'R',
			'env': env,
		};

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const rVersion = rHome.version;

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
