/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';

import { JupyterKernelSpec } from './jupyter-adapter';
import { getArkKernelPath } from './kernel';
import { getPandocPath } from './pandoc';

/**
 * Create a new Jupyter kernel spec.
 *
 * @param rHomePath The R_HOME path for the R version
 * @param runtimeName The (display) name of the runtime
 * @param sessionMode The mode in which to create the session
 *
 * @returns A JupyterKernelSpec definining the kernel's path, arguments, and
 *  metadata.
 */
export function createJupyterKernelSpec(
	rHomePath: string,
	runtimeName: string,
	sessionMode: positron.LanguageRuntimeSessionMode): JupyterKernelSpec {

	// Path to the kernel executable
	const kernelPath = getArkKernelPath();
	if (!kernelPath) {
		throw new Error('Unable to find R kernel');
	}

	// Check the R kernel log level setting
	const config = vscode.workspace.getConfiguration('positron.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';
	const logLevelForeign = config.get<string>('kernel.logLevelExternal') ?? 'warn';
	const userEnv = config.get<object>('kernel.env') ?? {};
	const profile = config.get<string>('kernel.profile');


	/* eslint-disable */
	const env = <Record<string, string>>{
		'RUST_BACKTRACE': '1',
		'RUST_LOG': logLevelForeign + ',ark=' + logLevel,
		'R_HOME': rHomePath,
		...userEnv
	};
	/* eslint-enable */

	if (profile) {
		env['ARK_PROFILE'] = profile;
	}

	if (process.platform === 'linux') {
		// Workaround for
		// https://github.com/posit-dev/positron/issues/1619#issuecomment-1971552522
		env['LD_LIBRARY_PATH'] = rHomePath + '/lib';
	} else if (process.platform === 'darwin') {
		// Workaround for
		// https://github.com/posit-dev/positron/issues/3732
		env['DYLD_LIBRARY_PATH'] = rHomePath + '/lib';
	}

	// Inject the path to the Pandoc executable into the environment; R packages
	// that use Pandoc for rendering will need this.
	//
	// On MacOS, the binary path lives alongside the app bundle; on other
	// platforms, it's a couple of directories up from the app root.
	const pandocPath = getPandocPath();
	if (pandocPath) {
		env['RSTUDIO_PANDOC'] = pandocPath;
	}

	// R script to run on session startup
	const startupFile = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'startup.R');

	const argv = [
		kernelPath,
		'--connection_file', '{connection_file}',
		'--log', '{log_file}',
		'--startup-file', `${startupFile}`,
		'--session-mode', `${sessionMode}`,
	];

	// Only create profile if requested in configuration
	if (profile) {
		argv.push(...[
			'--profile', '{profile_file}',
		]);
	}

	argv.push(...[
		// The arguments after `--` are passed verbatim to R
		'--',
		'--interactive',
	]);

	// Create a kernel spec for this R installation
	const kernelSpec: JupyterKernelSpec = {
		'argv': argv,
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
	const quietMode = config.get<boolean>('quietMode');
	if (quietMode && extraArgs?.indexOf('--quiet') === -1) {
		extraArgs?.push('--quiet');
	}
	if (extraArgs) {
		kernelSpec.argv.push(...extraArgs);
	}

	return kernelSpec;
}
