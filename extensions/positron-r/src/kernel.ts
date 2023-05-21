/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';

import { withActiveExtension } from './util';
import { ArkLsp } from './lsp';

// TODO@softwarenerd - I would like to load this from a file, but I am not smart enough to do it.
const iconSVG = `
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 100 100" enable-background="new 0 0 100 100" xml:space="preserve">
	<linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="-48.9322" y1="150.8798" x2="-48.7958" y2="150.7433" gradientTransform="matrix(721.094 0 0 -482.937 35285.5117 72877.4922)">
		<stop  offset="0" style="stop-color:#CCCED0"/>
		<stop  offset="1" style="stop-color:#85848C"/>
	</linearGradient>
	<path fill-rule="evenodd" clip-rule="evenodd" fill="url(#SVGID_1_)" d="M50,78C22.8,78,0.8,63.2,0.8,45c0-18.2,22-32.9,49.2-32.9c27.2,0,49.2,14.7,49.2,32.9C99.2,63.2,77.2,78,50,78z M57.5,24.9c-20.6,0-37.4,10.1-37.4,22.5S36.9,70,57.5,70c20.6,0,35.9-6.9,35.9-22.5C93.4,31.8,78.2,24.9,57.5,24.9z"/>
	<linearGradient id="SVGID_00000075146920461689179980000013175888087647547526_" gradientUnits="userSpaceOnUse" x1="-49.5303" y1="151.1673" x2="-49.3939" y2="151.0309" gradientTransform="matrix(398 0 0 -406.124 19751 61428.6641)">
		<stop  offset="0" style="stop-color:#336DB6"/>
		<stop  offset="1" style="stop-color:#1C5EAA"/>
	</linearGradient>
	<path fill-rule="evenodd" clip-rule="evenodd" fill="url(#SVGID_00000075146920461689179980000013175888087647547526_)" d="M75.7,63.1c0,0,3,0.9,4.7,1.8c0.6,0.3,1.6,0.9,2.4,1.7c0.7,0.8,1.1,1.6,1.1,1.6l11.7,19.8l-19,0l-8.9-16.7c0,0-1.8-3.1-2.9-4c-0.9-0.8-1.3-1-2.3-1c-0.6,0-4.5,0-4.5,0l0,21.7l-16.8,0V32.5H75c0,0,15.3,0.3,15.3,14.9S75.7,63.1,75.7,63.1z M68.4,44.5l-10.2,0l0,9.4l10.2,0c0,0,4.7,0,4.7-4.8C73.1,44.3,68.4,44.5,68.4,44.5z"/>
</svg>`;
const base64EncodedIconSvg = Buffer.from(iconSVG).toString('base64');

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
		console.error(`Error getting R version: ${e}`);
	}
	return rVersion;
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): void {

	class RInstallation {
		public readonly rHome: string;
		public readonly rVersion: string;

		constructor(rHome: string) {
			this.rHome = rHome;
			this.rVersion = getRVersion(rHome);
		}
	}

	const rInstallations: Array<RInstallation> = [];

	const { execSync } = require('child_process');

	// Discover R installations.
	// TODO: Needs to handle Linux and Windows
	// TODO: Needs to handle other installation locations (like RSwitch)

	// Look for the default R installation on macOS
	if (fs.existsSync('/Library/Frameworks/R.framework/Resources')) {
		rInstallations.push(
			new RInstallation('/Library/Frameworks/R.framework/Resources'));
	}

	// Look for an R installation on the $PATH (e.g. installed via Homebrew)
	try {
		// Try R RHOME to get the installation path; run under bash so we get $PATH
		// set as the user would expect.
		const rHome = execSync('R RHOME', { shell: '/bin/bash', encoding: 'utf8' }).trim();
		if (fs.existsSync(rHome)) {
			// Add the R installation to the list (if it's not already there)
			if (rInstallations.filter(r => r.rHome === rHome).length === 0) {
				rInstallations.push(new RInstallation(rHome));
			}
		}
	} catch (err) {
		// Just swallow this; it's okay if there's no R on the $PATH
	}

	// Sort the R installations by version number, descending. This ensures that
	// we'll use the most recent version of R if R is installed in multiple
	// places.
	rInstallations.sort((a, b) => {
		return b.rVersion.localeCompare(a.rVersion);
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
			'RUST_LOG': 'trace',
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

		// Create a kernel spec for this R installation
		const kernelSpec = {
			path: rHome.rHome,
			'argv': [
				kernelPath,
				'--connection_file', '{connection_file}',
				'--log', '{log_file}'
			],
			'display_name': `R: ${rHome.rHome}`, // eslint-disable-line
			'language': 'R',
			'env': env,
		};

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const version = packageJson.version;

		// Create an LSP language server for this R installation
		const lsp = new ArkLsp(rHome.rVersion);

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		runtime = ext.exports.adaptKernel(
			kernelSpec,
			'r',      // Language ID
			rHome.rVersion ?? '0.0.1',   // Version of R, if we know it
			version,  // Version of this extension
			base64EncodedIconSvg, // The Base64-encoded icon SVG for the language
			'>', 	// Input prompt
			'+',	// Continuation prompt
			positron.LanguageRuntimeStartupBehavior.Implicit, // OK to start the kernel automatically
			(port: number) => {
				// Activate the LSP language server when the adapter is ready.
				return lsp.activate(port, context);
			});

		// Associate the LSP client instance with the kernel adapter.
		lsp.attachRuntime(runtime);
		context.subscriptions.push(lsp);

		// Register a language runtime provider for the ARK kernel.
		const disposable = positron.runtime.registerLanguageRuntime(runtime);

		// Ensure that the kernel is disposed when the extension is deactivated.
		context.subscriptions.push(disposable);
	}
}

