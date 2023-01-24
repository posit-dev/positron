/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';

import { withActiveExtension } from './util';

import { activateLsp } from './lsp';
import { Disposable } from 'vscode-languageclient';

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

	// Record existing value of DYLD_FALLBACK_LIBRARY_PATH so we can prepend to
	// it below. We use this to ensure that the R installation loaded by the
	// kernel is the one the user selected.
	const dyldFallbackLibraryPath = process.env['DYLD_FALLBACK_LIBRARY_PATH'];

	// Loop over the R installations and create a language runtime for each one.
	const disposables: vscode.Disposable[] = rInstallations.map(rHome => {

		// Create a kernel spec for this R installation
		const kernelSpec = {
			'argv': [kernelPath,
				'--connection_file', '{connection_file}',
				'--log', '{log_file}'],
			'display_name': `R: ${rHome.rHome}`, // eslint-disable-line
			'language': 'R',
			'env': {
				'RUST_LOG': 'trace', // eslint-disable-line
				'R_HOME': rHome.rHome, // eslint-disable-line
				'DYLD_INSERT_LIBRARIES': `${rHome.rHome}/lib/libR.dylib`, // eslint-disable-line
				'DYLD_FALLBACK_LIBRARY_PATH': `${rHome.rHome}/lib:${dyldFallbackLibraryPath}`, // eslint-disable-line
				'RUST_BACKTRACE': '1' // eslint-disable-line
			}
		};

		// Get the version of this extension from package.json so we can pass it
		// to the adapter as the implementation version.
		const packageJson = require('../package.json');
		const version = packageJson.version;

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		runtime = ext.exports.adaptKernel(kernelSpec, 'r', rHome.rVersion ?? '0.0.1', version, () => {
			return activateLsp(context);
		});

		// Register a language runtime provider for the ARK kernel.
		return positron.runtime.registerLanguageRuntime(runtime);
	});

	// Ensure that the language runtime registrations are torn down when the
	// extension is deactivated.
	context.subscriptions.push(...disposables);
}

