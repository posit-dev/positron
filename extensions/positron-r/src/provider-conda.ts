/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { exec } from 'child_process';
import { RBinary } from './provider.js';
import { ReasonDiscovered } from './r-installation.js';

const execPromise = util.promisify(exec);

/**
 * Check if Conda is installed by running `conda --version`
 */
export async function isCondaAvailable(): Promise<boolean> {
	try {
		await execPromise('conda --version');
		return true;
	} catch {
		return false;
	}
}

/**
 * Retrieve Conda environment paths from ~/.conda/environments.txt
 */
function getCondaEnvironmentsFromFile(): string[] {
	try {
		const environmentsFile = path.join(os.homedir(), '.conda', 'environments.txt');
		if (!fs.existsSync(environmentsFile)) {
			LOGGER.debug('Conda environments.txt file not found at:', environmentsFile);
			return [];
		}

		const content = fs.readFileSync(environmentsFile, 'utf-8');
		const envs = content
			.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0 && fs.existsSync(line));

		LOGGER.info(`Found ${envs.length} Conda environment(s) from environments.txt`);
		return envs;
	} catch (error) {
		LOGGER.error('Failed to read Conda environments.txt:', error);
		return [];
	}
}

/**
 * Retrieve Conda environment paths using `conda env list --json`
 * Falls back to reading ~/.conda/environments.txt if conda is not on PATH
 */
export async function getCondaEnvironments(): Promise<string[]> {
	// Try using conda command first (preferred method)
	try {
		const { stdout } = await execPromise('conda env list --json');
		const envs = JSON.parse(stdout).envs as string[];
		LOGGER.info(`Found ${envs.length} Conda environment(s) using conda command`);
		return envs;
	} catch (error) {
		LOGGER.debug('conda command not available, falling back to environments.txt');

		// Fall back to reading environments.txt file
		return getCondaEnvironmentsFromFile();
	}
}

/**
 * Discover R binaries inside Conda environments
 */

/**
 * Get expected R binary path inside a Conda environment
 */
export function getCondaRPaths(envPath: string): string[] {
	const paths: string[] = [];
	if (process.platform !== 'win32') {
		paths.push(path.join(envPath, 'bin', 'R'));
	} else {
		paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'x64', 'R.exe')); // Prioritise x64 binaries
		paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'R.exe'));
	}
	return paths;
}

/**
 * Discovers R binaries that are installed in conda environments.
 * @returns conda R binaries.
 */
export async function discoverCondaBinaries(): Promise<RBinary[]> {

	const rBinaries: RBinary[] = [];

	const enabled = vscode.workspace.getConfiguration('positron.r').get<boolean>('interpreters.condaDiscovery');
	if (enabled) {
		// getCondaEnvironments() will try conda command first, then fall back to environments.txt
		const condaEnvs = await getCondaEnvironments();

		if (condaEnvs.length === 0) {
			LOGGER.info('No Conda environments found.');
			return [];
		}

		for (const envPath of condaEnvs) {
			const rPaths = getCondaRPaths(envPath);  // list of R binaries in this environment

			if (rPaths.length === 0) {
				continue;
			}

			for (const rPath of rPaths) {
				if (fs.existsSync(rPath)) { // return the first existing R
					LOGGER.info(`Detected R in Conda environment: ${rPath}`);
					rBinaries.push({
						path: rPath,
						reasons: [ReasonDiscovered.CONDA],
						condaEnvironmentPath: envPath
					});
					break;
				}
			}

		}
	}

	return rBinaries;
}

/**
 * Find the conda activate script path from a conda environment path
 * On Windows, returns the full path to activate.bat
 * On Unix, returns undefined (conda activate works via shell function)
 *
 * @param envPath Path to the conda environment
 * @returns Path to activate script, or undefined if not found or not needed
 */
export function findCondaActivateScript(envPath: string): string | undefined {
	if (process.platform !== 'win32') {
		// On Unix-like systems, conda activate is typically a shell function
		// so we don't need to find a script path
		return undefined;
	}

	// On Windows, try to find activate.bat
	// The environment path is typically: <conda_root>\envs\<env_name>
	// or for the base environment: <conda_root>

	// First, try to find conda root by looking for 'envs' in the path
	const pathParts = envPath.split(path.sep);
	const envsIndex = pathParts.indexOf('envs');

	let condaRoot: string;
	if (envsIndex !== -1) {
		// This is an environment in the envs folder
		condaRoot = pathParts.slice(0, envsIndex).join(path.sep);
	} else {
		// This might be the base environment, try parent directory
		condaRoot = path.dirname(envPath);
	}

	// Try to find activate.bat in Scripts directory
	const activatePath = path.join(condaRoot, 'Scripts', 'activate.bat');
	if (fs.existsSync(activatePath)) {
		LOGGER.info(`Found conda activate.bat at: ${activatePath}`);
		return activatePath;
	}

	// If that didn't work, try the condabin directory (newer conda installations)
	const condabinActivatePath = path.join(condaRoot, 'condabin', 'activate.bat');
	if (fs.existsSync(condabinActivatePath)) {
		LOGGER.info(`Found conda activate.bat at: ${condabinActivatePath}`);
		return condabinActivatePath;
	}

	LOGGER.warn(`Could not find conda activate.bat for environment: ${envPath}`);
	return undefined;
}
