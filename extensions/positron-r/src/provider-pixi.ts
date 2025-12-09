/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { exec } from 'child_process';
import { RBinary } from './provider.js';
import { ReasonDiscovered } from './r-installation.js';

const execPromise = util.promisify(exec);

/**
 * Information about a Pixi project and its environments
 */
interface PixiInfo {
	version: string;
	project_info?: {
		manifest_path: string;
	};
	environments_info: {
		name: string;
		prefix: string;
	}[];
}

/**
 * Get the path to the pixi executable
 */
async function findPixi(): Promise<string | undefined> {
	// First, try to find pixi on PATH
	try {
		const whichCommand = process.platform === 'win32' ? 'where pixi' : 'which pixi';
		const { stdout } = await execPromise(whichCommand);
		// 'where' on Windows may return multiple lines, take the first one
		const pixiPath = stdout.trim().split('\n')[0].trim();
		if (pixiPath && fs.existsSync(pixiPath)) {
			return pixiPath;
		}
	} catch {
		// pixi not found on PATH
	}

	// Check the default installation location
	if (process.platform === 'win32') {
		const localAppData = process.env.LOCALAPPDATA;
		if (localAppData) {
			const defaultPath = path.join(localAppData, 'pixi', 'bin', 'pixi.exe');
			if (fs.existsSync(defaultPath)) {
				return defaultPath;
			}
		}
		const userProfile = process.env.USERPROFILE;
		if (userProfile) {
			const defaultPath = path.join(userProfile, '.pixi', 'bin', 'pixi.exe');
			if (fs.existsSync(defaultPath)) {
				return defaultPath;
			}
		}
	} else {
		const home = process.env.HOME;
		if (home) {
			const defaultPath = path.join(home, '.pixi', 'bin', 'pixi');
			if (fs.existsSync(defaultPath)) {
				return defaultPath;
			}
		}
	}

	return undefined;
}

/**
 * Get Pixi environments for a workspace folder by running `pixi info --json`
 */
async function getPixiEnvironments(workspaceFolder: string): Promise<{ prefix: string; manifestPath: string; envName: string }[]> {
	const pixi = await findPixi();
	if (!pixi) {
		LOGGER.debug('Pixi executable not found');
		return [];
	}

	try {
		const { stdout } = await execPromise(`"${pixi}" info --json`, { cwd: workspaceFolder });
		const pixiInfo: PixiInfo = JSON.parse(stdout);

		if (!pixiInfo.project_info || !pixiInfo.environments_info) {
			LOGGER.debug(`No Pixi project found in ${workspaceFolder}`);
			return [];
		}

		const manifestPath = pixiInfo.project_info.manifest_path;
		return pixiInfo.environments_info.map(env => ({
			prefix: env.prefix,
			manifestPath,
			envName: env.name
		}));
	} catch (error) {
		LOGGER.debug(`Failed to get Pixi info for ${workspaceFolder}:`, error);
		return [];
	}
}

/**
 * Get expected R binary path inside a Pixi environment
 */
export function getPixiRPaths(envPath: string): string[] {
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
 * Discovers R binaries that are installed in Pixi environments within open workspaces.
 * @returns Pixi R binaries.
 */
export async function discoverPixiBinaries(): Promise<RBinary[]> {
	const rBinaries: RBinary[] = [];

	const enabled = vscode.workspace.getConfiguration('positron.r').get<boolean>('interpreters.pixiDiscovery');
	if (!enabled) {
		return [];
	}

	// Get all workspace folders
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		LOGGER.debug('No workspace folders open for Pixi discovery');
		return [];
	}

	for (const folder of workspaceFolders) {
		const folderPath = folder.uri.fsPath;

		// Check if this workspace has a pixi.toml file
		const pixiTomlPath = path.join(folderPath, 'pixi.toml');
		const pyprojectPath = path.join(folderPath, 'pyproject.toml');

		if (!fs.existsSync(pixiTomlPath) && !fs.existsSync(pyprojectPath)) {
			continue;
		}

		// For pyproject.toml, check if it has a [tool.pixi] section
		if (!fs.existsSync(pixiTomlPath) && fs.existsSync(pyprojectPath)) {
			try {
				const content = fs.readFileSync(pyprojectPath, 'utf-8');
				if (!content.includes('[tool.pixi]')) {
					continue;
				}
			} catch {
				continue;
			}
		}

		const pixiEnvs = await getPixiEnvironments(folderPath);

		if (pixiEnvs.length === 0) {
			LOGGER.debug(`No Pixi environments found in ${folderPath}`);
			continue;
		}

		for (const env of pixiEnvs) {
			const rPaths = getPixiRPaths(env.prefix);

			for (const rPath of rPaths) {
				if (fs.existsSync(rPath)) {
					LOGGER.info(`Detected R in Pixi environment: ${rPath}`);
					rBinaries.push({
						path: rPath,
						reasons: [ReasonDiscovered.PIXI],
						pixiEnvironmentPath: env.prefix,
						pixiManifestPath: env.manifestPath,
						pixiEnvironmentName: env.envName
					});
					break; // Use first existing R binary for this environment
				}
			}
		}
	}

	LOGGER.info(`Found ${rBinaries.length} R installation(s) in Pixi environments`);
	return rBinaries;
}

/**
 * Find the pixi executable path
 * @returns Path to pixi executable, or undefined if not found
 */
export async function findPixiExe(): Promise<string | undefined> {
	return findPixi();
}
