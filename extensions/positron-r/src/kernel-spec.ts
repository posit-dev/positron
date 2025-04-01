/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { JupyterKernelSpec } from './positron-supervisor';
import { getArkKernelPath } from './kernel';
import { getPandocPath } from './pandoc';
import { EXTENSION_ROOT_DIR } from './constants';

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

	// Set the default repositories
	const defaultRepos = config.get<string>('defaultRepositories') ?? 'auto';
	if (defaultRepos === 'auto') {
		const reposConf = findReposConf();
		if (reposConf) {
			// If there's a `repos.conf` file in a well-known directory, use
			// that.
			argv.push(...['--repos-conf', reposConf]);
		} else if (vscode.env.uiKind === vscode.UIKind.Web) {
			// No repos.conf; if we're web mode use Posit's Public Package
			// Manager
			argv.push(...['--default-repos', 'posit-ppm']);
		}
		// In all other cases when `auto` is set, we don't specify
		// `--default-repos` at all, and let Ark choose an appropriate
		// repository (usually `cran.rstudio.com)
	} else {
		// The remaining options map directly to Ark's `--default-repos`
		// command line option
		argv.push(...['--default-repos', defaultRepos]);
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
		// Protocol version 5.5 signals support for JEP 66
		'kernel_protocol_version': '5.5' // eslint-disable-line
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

/**
 * Attempt to find a `repos.conf` file in Positron or RStudio XDG
 * configuration directories.
 *
 * Returns the path to the file if found, or `undefined` if no
 */
function findReposConf(): string | undefined {
	const xdg = require('xdg-portable/cjs');
	const configDirs: Array<string> = xdg.configDirs();
	for (const product of ['rstudio', 'positron']) {
		for (const configDir of configDirs) {
			const reposConf = path.join(configDir, product, 'repos.conf');
			if (fs.existsSync(reposConf)) {
				return reposConf;
			}
		}
	}
	return;
}
