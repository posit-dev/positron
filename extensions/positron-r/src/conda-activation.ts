/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as util from 'util';
import { exec } from 'child_process';
import { LOGGER } from './extension';

const execPromise = util.promisify(exec);

/**
 * Enum for conda/mamba command types
 */
enum CondaCommand {
	CONDA = 'conda',
	MAMBA = 'mamba'
}

/**
 * Find which conda-compatible command is available (conda or mamba)
 */
async function findCondaCommand(): Promise<CondaCommand | undefined> {
	// Try mamba first as it's faster
	try {
		await execPromise('mamba --version');
		LOGGER.info('Found mamba for environment activation');
		return CondaCommand.MAMBA;
	} catch {
		// Mamba not available, try conda
		try {
			await execPromise('conda --version');
			LOGGER.info('Found conda for environment activation');
			return CondaCommand.CONDA;
		} catch {
			LOGGER.warn('Neither conda nor mamba found in PATH');
			return undefined;
		}
	}
}

/**
 * Get environment variables from activating a conda environment
 *
 * This function activates the conda environment and captures the resulting
 * environment variables, which can then be passed to the R kernel process.
 *
 * @param condaEnvPath The path to the conda environment to activate
 * @returns A record of environment variables, or undefined if activation fails
 */
export async function getCondaActivationEnvironment(
	condaEnvPath: string
): Promise<Record<string, string> | undefined> {
	const condaCommand = await findCondaCommand();
	if (!condaCommand) {
		LOGGER.error('Cannot activate conda environment: conda/mamba not found in PATH');
		return undefined;
	}

	try {
		LOGGER.info(`Activating conda environment at: ${condaEnvPath}`);

		let command: string;
		if (process.platform === 'win32') {
			// On Windows, use cmd.exe to activate and print environment
			// We use && to chain commands so the second only runs if first succeeds
			command = `cmd /c "${condaCommand} activate ${condaEnvPath} && set"`;
		} else {
			// On Unix-like systems, we need to source the conda setup and activate
			// The key is to source conda.sh (or mamba.sh) first, then activate, then print env
			const shell = process.env.SHELL || '/bin/bash';
			const shellName = path.basename(shell);

			// Get conda/mamba base path
			const { stdout: condaInfo } = await execPromise(`${condaCommand} info --json`);
			const info = JSON.parse(condaInfo);
			const condaBasePath = info.root_prefix || info.conda_prefix;

			if (!condaBasePath) {
				LOGGER.error('Could not determine conda base path');
				return undefined;
			}

			// Construct path to activation script
			let activationScript: string;
			if (shellName.includes('fish')) {
				activationScript = path.join(condaBasePath, 'etc', 'fish', 'conf.d', `${condaCommand}.fish`);
				command = `fish -c "source ${activationScript}; conda activate ${condaEnvPath}; env"`;
			} else if (shellName.includes('zsh')) {
				activationScript = path.join(condaBasePath, 'etc', 'profile.d', `${condaCommand}.sh`);
				command = `zsh -c '. ${activationScript}; conda activate ${condaEnvPath}; env'`;
			} else {
				// Default to bash
				activationScript = path.join(condaBasePath, 'etc', 'profile.d', `${condaCommand}.sh`);
				command = `bash -c '. ${activationScript}; conda activate ${condaEnvPath}; env'`;
			}

			LOGGER.debug(`Using activation command: ${command}`);
		}

		// Execute the command to get the environment
		const { stdout } = await execPromise(command, {
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large environments
			timeout: 30000 // 30 second timeout
		});

		// Parse environment variables from output
		const env: Record<string, string> = {};
		const lines = stdout.split(/\r?\n/);

		for (const line of lines) {
			// Skip empty lines
			if (!line.trim()) {
				continue;
			}

			// Environment variables are in the format KEY=value
			const equalIndex = line.indexOf('=');
			if (equalIndex > 0) {
				const key = line.substring(0, equalIndex);
				const value = line.substring(equalIndex + 1);

				// Skip internal shell variables and functions
				if (key.startsWith('BASH_FUNC_') || key.startsWith('_')) {
					continue;
				}

				env[key] = value;
			}
		}

		// Verify that conda-specific variables are present
		if (!env.CONDA_PREFIX && !env.CONDA_DEFAULT_ENV) {
			LOGGER.warn('Conda activation may have failed: CONDA_PREFIX not found in environment');
			return undefined;
		}

		LOGGER.info(`Successfully activated conda environment. CONDA_PREFIX=${env.CONDA_PREFIX}`);
		LOGGER.debug(`Captured ${Object.keys(env).length} environment variables`);

		return env;
	} catch (error) {
		LOGGER.error(`Failed to activate conda environment at ${condaEnvPath}: ${error}`);
		return undefined;
	}
}

/**
 * Check if conda or mamba is available
 */
export async function isCondaAvailable(): Promise<boolean> {
	const command = await findCondaCommand();
	return command !== undefined;
}
