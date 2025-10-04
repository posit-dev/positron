/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { arePathsSame, isParentPath, untildify } from './path-utils';

/**
 * Directory(ies) where this user keeps R installations.
 * Converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of directories to scan for R installations.
 */
export function userRHeadquarters(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const customRootFolders = config.get<string[]>('customRootFolders') ?? [];
	if (customRootFolders.length === 0) {
		LOGGER.debug('No custom root folders specified via positron.r.customRootFolders');
		return [];
	}
	const userHqDirs = customRootFolders
		.map((item) => path.normalize(untildify(item)))
		.filter((item) => {
			if (path.isAbsolute(item)) {
				return true;
			}
			LOGGER.info(`R custom root folder path ${item} is not absolute...ignoring`);
			return false;
		});
	const formattedPaths = JSON.stringify(userHqDirs, null, 2);
	LOGGER.info(`Directories from 'positron.r.customRootFolders' to scan for R installations:\n${formattedPaths}`);
	return userHqDirs;
}

/**
 * Ad hoc R binaries the user wants Positron to know about.
 * @returns List of custom R binaries specified by the user.
 */
export function userRBinaries(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const customBinaries = config.get<string[]>('customBinaries') ?? [];
	if (customBinaries.length === 0) {
		LOGGER.debug('No custom binaries specified via positron.r.customBinaries');
		return [];
	}
	const userBinaries = customBinaries
		.map((item) => path.normalize(untildify(item)))
		.filter((item) => {
			if (path.isAbsolute(item)) {
				return true;
			}
			LOGGER.info(`R custom binary path ${item} is not absolute...ignoring`);
			return false;
		});
	const formattedPaths = JSON.stringify(userBinaries, null, 2);
	LOGGER.info(`R binaries from 'positron.r.customBinaries' to discover:\n${formattedPaths}`);
	return userBinaries;
}

/**
 * Gets the list of R installations excluded via settings.
 * Converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of installation paths to exclude.
 */
function getExcludedInstallations(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const interpretersExclude = config.get<string[]>('interpreters.exclude') ?? [];
	if (interpretersExclude.length === 0) {
		LOGGER.debug('No installation paths specified to exclude via positron.r.interpreters.exclude');
		return [];
	}
	const excludedPaths = interpretersExclude
		.map((item) => path.normalize(untildify(item)))
		.filter((item) => {
			if (path.isAbsolute(item)) {
				return true;
			}
			LOGGER.info(`R installation path to exclude ${item} is not absolute...ignoring`);
			return false;
		});
	const formattedPaths = JSON.stringify(excludedPaths, null, 2);
	LOGGER.info(`R installation paths from 'positron.r.interpreters.exclude' to exclude:\n${formattedPaths}`);
	return excludedPaths;
}

/**
 * Gets the list of R installations to override the installations we make available.
 * The override setting take precedence over the excluded installations, the custom binaries
 * and the custom root folders settings.
 * Converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of installation paths to exclusively include.
 */
export function getInterpreterOverridePaths(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const interpretersOverride = config.get<string[]>('interpreters.override') ?? [];
	if (interpretersOverride.length === 0) {
		LOGGER.debug('No installation paths specified to exclusively include via positron.r.interpreters.override');
		return [];
	}
	const overridePaths = interpretersOverride
		.map((item) => path.normalize(untildify(item)))
		.filter((item) => {
			if (path.isAbsolute(item)) {
				return true;
			}
			LOGGER.info(`R installation path to exclusively include ${item} is not absolute...ignoring`);
			return false;
		});
	const formattedPaths = JSON.stringify(overridePaths, null, 2);
	LOGGER.info(`R installation paths from 'positron.r.interpreters.override' to exclusively include:\n${formattedPaths}`);
	return overridePaths;
}

/**
 * Checks if the given binary path is excluded via settings. If interpreter override paths are
 * specified, this method will return true if the binary path is not in the override paths. The
 * override paths take precedence over the excluded installations.
 * @param binpath The binary path to check
 * @returns True if the binary path is excluded, false if it is not excluded, and undefined if the
 * no exclusions have been specified.
 */
export function isExcludedInstallation(binpath: string): boolean | undefined {
	const overridePaths = getInterpreterOverridePaths();
	if (overridePaths.length > 0) {
		// Override paths are exclusive include paths, so an interpreter is excluded if it is not in
		// the override paths.
		return !overridePaths.some(
			override => isParentPath(binpath, override) || arePathsSame(binpath, override)
		);
	}

	const excludedInstallations = getExcludedInstallations();
	if (excludedInstallations.length === 0) {
		return undefined;
	}
	return excludedInstallations.some(
		excluded => isParentPath(binpath, excluded) || arePathsSame(binpath, excluded)
	);
}

/**
 * Get the default R interpreter path specified in Positron settings.
 * Converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns The default R interpreter path specified in the settings, or undefined if not set.
 */
export function getDefaultInterpreterPath(): string | undefined {
	const config = vscode.workspace.getConfiguration('positron.r');
	let defaultInterpreterPath = config.get<string>('interpreters.default');
	if (defaultInterpreterPath) {
		defaultInterpreterPath = path.normalize(untildify(defaultInterpreterPath));
		if (path.isAbsolute(defaultInterpreterPath)) {
			LOGGER.info(`Default R interpreter path specified in 'positron.r.interpreters.default': ${defaultInterpreterPath}`);
			return defaultInterpreterPath;
		}
		LOGGER.info(`Default R interpreter path ${defaultInterpreterPath} is not absolute...ignoring`);
		return undefined;
	}
	return undefined;
}

/**
 * Print the R interpreter settings info to the log.
 */
export function printInterpreterSettingsInfo(): void {
	const interpreterSettingsInfo = {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'interpreters.default': getDefaultInterpreterPath(),
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'interpreters.override': getInterpreterOverridePaths(),
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'interpreters.exclude': getExcludedInstallations(),
		'customRootFolders': userRHeadquarters(),
		'customBinaries': userRBinaries(),
	};
	LOGGER.info('=====================================================================');
	LOGGER.info('=============== [START] R INTERPRETER SETTINGS INFO =================');
	LOGGER.info('=====================================================================');
	LOGGER.info('R interpreter settings:', JSON.stringify(interpreterSettingsInfo, null, 2));
	LOGGER.info('=====================================================================');
	LOGGER.info('================ [END] R INTERPRETER SETTINGS INFO ==================');
	LOGGER.info('=====================================================================');
}
