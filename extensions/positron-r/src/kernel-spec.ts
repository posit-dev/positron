/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

import { JupyterKernelSpec } from './positron-supervisor';
import { getArkKernelPath } from './kernel';
import { EXTENSION_ROOT_DIR } from './constants';
import { findCondaExe } from './provider-conda';
import { LOGGER } from './extension';

/**
 * Set speculative Conda environment variables. While it's preferable to capture
 * them accurately, this is a fussy and error-prone process; this function at
 * least ensures that key variables are set so that R and other tools can find
 * the right libraries and executables.
 *
 * Only used when an error occurs during proper capture of the environment
 * (using conda activate).
 */
function setSpeculativeCondaEnvVars(env: Record<string, string>, envPath: string, condaExe?: string): void {
	env['CONDA_PREFIX'] = envPath;
	env['CONDA_DEFAULT_ENV'] = path.basename(envPath);
	env['CONDA_SHLVL'] = '1';
	env['CONDA_CHANGEPS1'] = 'no';
	env['CONDA_PROMPT_MODIFIER'] = '';
	const pathParts: string[] = [];
	if (condaExe) {
		env['CONDA_EXE'] = condaExe;
		// Find conda root from condaExe
		const condaRoot = path.dirname(path.dirname(condaExe));
		env['CONDA_PYTHON_EXE'] = path.join(condaRoot, 'python.exe');
		// Add base paths to PATH
		pathParts.push(
			path.join(condaRoot, 'Scripts'),
			condaRoot,
			path.join(condaRoot, 'Library', 'bin')
		);
	}
	// Add env paths to PATH
	pathParts.push(
		path.join(envPath, 'Scripts'),
		envPath,
		path.join(envPath, 'Library', 'bin'),
		path.join(envPath, 'Lib', 'R', 'bin', 'x64')
	);
	// Prepend to PATH
	const currentPath = process.env.PATH || '';
	env['PATH'] = pathParts.join(';') + ';' + currentPath;
}

/**
 * Capture conda environment variables on Windows by running the activation
 * script and capturing its output. Shows a progress notification if activation
 * takes longer than 2 seconds. If the user cancels, speculative environment
 * variables are used instead.
 *
 * @param env The environment record to populate with conda variables
 * @param envPath The path to the conda environment
 * @param envName The name of the conda environment
 * @returns A promise that resolves when activation is complete
 */
async function captureCondaEnvVarsWindows(env: Record<string, string>, envPath: string, envName: string): Promise<void> {
	const condaExe = findCondaExe(envPath);
	if (!condaExe) {
		LOGGER.error('Could not find conda.exe for environment:', envPath);
		setSpeculativeCondaEnvVars(env, envPath);
		return;
	}

	let cancelled = false;

	const doActivation = (): void => {
		try {
			// Form a command to get the activation script path
			const command = `"${condaExe}" shell.cmd.exe activate ${envName}`;
			LOGGER.debug(`Running to capture Conda variables: ${command}`);
			const scriptPath = execSync(command, { encoding: 'utf8', timeout: 10000 }).trim();
			if (fs.existsSync(scriptPath)) {
				const scriptContent = fs.readFileSync(scriptPath, 'utf8');
				// Try to delete the temp file to prevent Windows from opening it
				try {
					fs.unlinkSync(scriptPath);
				} catch (e) {
					LOGGER.warn('Failed to delete temp conda script file:', e);
				}
				// If cancelled while running, fall back to speculative values
				if (cancelled) {
					throw new Error('Conda activation cancelled by user');
				}
				const lines = scriptContent.split('\n');
				if (lines.length === 0) {
					throw new Error('Conda activation script is empty');
				}
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.includes('=')) {
						LOGGER.trace(`Skipping non-variable line: ${line}`);
						continue; // skip empty or non-var lines
					}
					const eqIndex = trimmed.indexOf('=');
					if (eqIndex === -1) {
						LOGGER.trace(`Skipping line without '=': ${line}`);
						continue;
					}
					const key = trimmed.substring(0, eqIndex).trim();
					const value = trimmed.substring(eqIndex + 1).trim();
					env[key] = value;
				}
			} else {
				throw new Error(`Activation script not found at ${scriptPath}`);
			}
		} catch (e) {
			// Log error and set speculative values
			LOGGER.error('Failed to capture conda environment variables:', e.message);
			if (e.stdout) {
				LOGGER.error('stdout:', e.stdout);
			}
			if (e.stderr) {
				LOGGER.error('stderr:', e.stderr);
			}
			setSpeculativeCondaEnvVars(env, envPath, condaExe);
		}
	};

	const activationPromise = new Promise<void>((resolve) => {
		doActivation();
		resolve();
	});

	// Show progress toast if activation takes longer than 2 seconds
	const progressDelay = 2000;
	let showProgress = true;

	const timeoutPromise = new Promise<void>((resolve) => {
		setTimeout(() => {
			if (showProgress) {
				vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: vscode.l10n.t("Activating Conda environment '{0}'...", envName),
						cancellable: true
					},
					async (_progress, token) => {
						token.onCancellationRequested(() => {
							cancelled = true;
							LOGGER.info('User cancelled conda activation');
						});
						await activationPromise;
					}
				);
			}
			resolve();
		}, progressDelay);
	});

	await Promise.race([activationPromise, timeoutPromise]);
	showProgress = false;
	await activationPromise;
}

/**
 * Create a new Jupyter kernel spec.
 *
 * @param rHomePath The R_HOME path for the R version
 * @param runtimeName The (display) name of the runtime
 * @param sessionMode The mode in which to create the session
 * @param options Additional options: specifically, the R binary path, architecture, and conda environment path
 *
 * @returns A JupyterKernelSpec definining the kernel's path, arguments, and
 *  metadata.
 */
export async function createJupyterKernelSpec(
	rHomePath: string,
	runtimeName: string,
	sessionMode: positron.LanguageRuntimeSessionMode,
	options?: { rBinaryPath?: string; rArchitecture?: string; condaEnvironmentPath?: string }): Promise<JupyterKernelSpec> {

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

	// If this R is from a conda environment, activate the conda environment
	// to ensure that compilation tools and other dependencies are available
	let startup_command: string | undefined = undefined;
	if (options?.condaEnvironmentPath) {
		const envPath = options.condaEnvironmentPath;
		const envName = path.basename(envPath);
		if (process.platform === 'win32') {
			// On Windows, capture environment variables directly instead of using a startup command;
			// the startup command approach is unreliable on Windows
			await captureCondaEnvVarsWindows(env, envPath, envName);
		} else {
			// On Unix-like systems, use conda activate as startup command
			startup_command = 'conda activate ' + envPath;
		}
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

	// On Windows, we need to tell ark to use a different DLL search path when
	// dealing with Conda environments. Conda R installations have DLL
	// dependencies in non-standard locations. These locations are part of the
	// PATH set during Conda activation, but by default Ark has a more limited set
	// of directories it searches for DLLs. The `--dll-search-path` option tells Ark
	// to use Windows' standard DLL search path, which includes the PATH entries.
	if (process.platform === 'win32' && options?.condaEnvironmentPath) {
		argv.push('--dll-search-path');
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
		'display_name': runtimeName,
		'language': 'R',
		'env': env,
		'startup_command': startup_command,
		// Protocol version 5.5 signals support for JEP 66
		'kernel_protocol_version': '5.5'
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
	// on Unix-alikes, also check /etc; RStudio uses /etc/rstudio instead of the
	// XDG dir /etc/xdg/rstudio
	if (process.platform !== 'win32') {
		configDirs.push('/etc');
	}
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
