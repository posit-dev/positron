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
import { EXTENSION_ROOT_DIR } from './constants';

/**
 * Create a new Jupyter kernel spec.
 *
 * @param rHomePath The R_HOME path for the R version
 * @param runtimeName The (display) name of the runtime
 * @param sessionMode The mode in which to create the session
 * @param options Additional options: specifically, the R binary path and architecture
 *
 * @returns A JupyterKernelSpec definining the kernel's path, arguments, and
 *  metadata.
 */
export function createJupyterKernelSpec(
	rHomePath: string,
	runtimeName: string,
	sessionMode: positron.LanguageRuntimeSessionMode,
	options?: { rBinaryPath?: string; rArchitecture?: string }): JupyterKernelSpec {

	// Path to the kernel executable
	const kernelPath = getArkKernelPath({
		rBinaryPath: options?.rBinaryPath,
		rHomePath,
		rArch: options?.rArchitecture
	});
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
	const ppmRepo = config.get<string>('packageManagerRepository');
	if (defaultRepos === 'auto') {
		const reposConf = findReposConf();
		if (reposConf) {
			// If there's a `repos.conf` file in a well-known directory, use
			// that.
			argv.push(...['--repos-conf', reposConf]);
		} else if (ppmRepo) {
			// If the user has specified a custom Package Manager URL, use it
			//
			// Note: Ark can't handle trailing slashes, so strip them here
			argv.push(...['--default-ppm-repo', ppmRepo.endsWith('/') ? ppmRepo.slice(0, -1) : ppmRepo]);
		} else if (vscode.env.uiKind === vscode.UIKind.Web) {
			// No repos.conf; if we're web mode use Posit's Public Package
			// Manager
			argv.push(...['--default-repos', 'posit-ppm']);
		}
		// In all other cases when `auto` is set, we don't specify
		// `--default-repos` at all, and let Ark choose an appropriate
		// repository (usually `cran.rstudio.com)
	} else {
		// Warn the user about inconsistent PPM settings.
		if (ppmRepo) {
			const openSettings = vscode.l10n.t('Open Settings');
			// Note: we don't `await` here to avoid stalling the kernel startup.
			vscode.window.showWarningMessage(
				vscode.l10n.t('The "Package Manager Repository" setting is ignored unless "Default Repositories" is set to "auto".'),
				{ title: openSettings },
				{ title: vscode.l10n.t('Dismiss'), isCloseAffordance: true },
			).then((action) => {
				if (action?.title === openSettings) {
					vscode.commands.executeCommand(
						'workbench.action.openSettings',
						'positron.r.defaultRepositories'
					);
				}
			});
		}
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

	// For temporary, approximate backward compatibility, check both
	// 'saveAndRestoreWorkspace' and 'restoreWorkspace', which was deprecated in
	// late October 2025. Remove the latter setting and check in a future release.
	const shouldSaveAndRestore = config.get<boolean>('saveAndRestoreWorkspace') || config.get<boolean>('restoreWorkspace');

	if (shouldSaveAndRestore) {
		// '--restore-data' is the default but let's be explicit for clarity and
		// symmetry with the other branch
		kernelSpec.argv.push('--restore-data', '--save');
	} else {
		kernelSpec.argv.push('--no-restore-data', '--no-save');
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
