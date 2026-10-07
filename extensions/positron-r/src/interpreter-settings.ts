/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { arePathsSame, isParentPath, normalizeUserPath } from './path-utils';
import { SubstitutionResult, substituteWorkspaceFolder } from './setting-variables';

/**
 * Replaces `${workspaceFolder}` in a path from an R interpreter setting with the first
 * workspace folder, then expands `~` and normalizes the result. Paths with a variable that
 * cannot be resolved, and relative paths, are ignored.
 * @param value The path from the setting
 * @param description Names the path in log messages, e.g. 'R custom binary path'. If omitted, ignored paths are not logged.
 * @returns The absolute path, or undefined if the path is ignored
 */
function resolveSettingPath(value: string, description?: string): string | undefined {
	const result = substituteWorkspaceFolder(value, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
	if (result.resolved === false) {
		if (description) {
			LOGGER.info(`${description} ${value} ${describeUnresolved(result)}...ignoring`);
		}
		return undefined;
	}
	const resolved = normalizeUserPath(result.value);
	if (!path.isAbsolute(resolved)) {
		if (description) {
			LOGGER.info(`${description} ${resolved} is not absolute...ignoring`);
		}
		return undefined;
	}
	return resolved;
}

function describeUnresolved(result: Extract<SubstitutionResult, { resolved: false }>): string {
	switch (result.reason) {
		case 'noFolder':
			return `uses ${result.variable}, but no folder is open`;
		case 'unsupported':
			return `uses unsupported variable ${result.variable} (only \${workspaceFolder} is supported)`;
	}
}

/**
 * Resolves each path in a list setting. Ignored paths are dropped and the rest are kept.
 */
function resolveSettingPaths(values: string[], description?: string): string[] {
	return values
		.map(value => resolveSettingPath(value, description))
		.filter((value): value is string => value !== undefined);
}

/**
 * Directory(ies) where this user keeps R installations.
 * Replaces `${workspaceFolder}` and converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of directories to scan for R installations.
 */
export function userRHeadquarters(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const customRootFolders = config.get<string[]>('customRootFolders') ?? [];
	if (customRootFolders.length === 0) {
		LOGGER.debug('No custom root folders specified via positron.r.customRootFolders');
		return [];
	}
	const userHqDirs = resolveSettingPaths(customRootFolders, 'R custom root folder path');
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
	const userBinaries = resolveSettingPaths(customBinaries, 'R custom binary path');
	const formattedPaths = JSON.stringify(userBinaries, null, 2);
	LOGGER.info(`R binaries from 'positron.r.customBinaries' to discover:\n${formattedPaths}`);
	return userBinaries;
}

/**
 * R binaries named by entries in the `interpreters.definitions` setting.
 * Paths must be absolute; other entries are ignored.
 * @returns List of R binary paths from interpreter definitions.
 */
export function getInterpreterDefinitionPaths(): string[] {
	const definitions = vscode.workspace.getConfiguration('interpreters').get<unknown>('definitions');
	if (!Array.isArray(definitions)) {
		return [];
	}
	const paths = definitions
		.filter(d => d?.language === 'r' && typeof d.path === 'string' && path.isAbsolute(d.path))
		.map(d => d.path as string);
	return Array.from(new Set(paths));
}

/**
 * Whether `interpreters.discovery` is `definitionsOnly` for R, in which case
 * only the R binaries in `interpreters.definitions` are used and no other
 * discovery runs.
 */
export function isDefinitionsOnlyDiscovery(): boolean {
	return vscode.workspace.getConfiguration('interpreters', { languageId: 'r' }).get<string>('discovery') === 'definitionsOnly';
}

/**
 * Gets the list of R installations excluded via settings.
 * Replaces `${workspaceFolder}` and converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of installation paths to exclude.
 */
function getExcludedInstallations(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const interpretersExclude = config.get<string[]>('interpreters.exclude') ?? [];
	if (interpretersExclude.length === 0) {
		LOGGER.debug('No installation paths specified to exclude via positron.r.interpreters.exclude');
		return [];
	}
	const excludedPaths = resolveSettingPaths(interpretersExclude, 'R installation path to exclude');
	const formattedPaths = JSON.stringify(excludedPaths, null, 2);
	LOGGER.info(`R installation paths from 'positron.r.interpreters.exclude' to exclude:\n${formattedPaths}`);
	return excludedPaths;
}

/**
 * Gets the list of R installations to override the installations we make available.
 * The override setting take precedence over the excluded installations, the custom binaries
 * and the custom root folders settings.
 * Replaces `${workspaceFolder}` and converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns List of installation paths to exclusively include.
 */
export function getInterpreterOverridePaths(): string[] {
	const config = vscode.workspace.getConfiguration('positron.r');
	const interpretersOverride = config.get<string[]>('interpreters.override') ?? [];
	if (interpretersOverride.length === 0) {
		LOGGER.debug('No installation paths specified to exclusively include via positron.r.interpreters.override');
		return [];
	}
	const overridePaths = resolveSettingPaths(interpretersOverride, 'R installation path to exclusively include');
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
 * Replaces `${workspaceFolder}` and converts aliased paths to absolute paths. Relative paths are ignored.
 * @returns The default R interpreter path specified in the settings, or undefined if not set.
 */
export function getDefaultInterpreterPath(): string | undefined {
	const config = vscode.workspace.getConfiguration('positron.r');
	const setting = config.get<string>('interpreters.default');
	if (!setting) {
		return undefined;
	}
	const defaultInterpreterPath = resolveSettingPath(setting, 'Default R interpreter path');
	if (defaultInterpreterPath) {
		LOGGER.info(`Default R interpreter path specified in 'positron.r.interpreters.default': ${defaultInterpreterPath}`);
	}
	return defaultInterpreterPath;
}

/**
 * Get the resolved `interpreters.exclude` and `interpreters.default` paths without logging,
 * for the discovery cache key. The key uses resolved paths because the same setting text,
 * e.g. `${workspaceFolder}/env/bin/R`, names a different binary in each workspace.
 * @returns The resolved paths. `default` is an empty string if unset or ignored.
 */
export function getResolvedFilterSettingPaths(): { exclude: string[]; default: string } {
	const config = vscode.workspace.getConfiguration('positron.r');
	const defaultSetting = config.get<string>('interpreters.default');
	return {
		exclude: resolveSettingPaths(config.get<string[]>('interpreters.exclude') ?? []),
		default: (defaultSetting && resolveSettingPath(defaultSetting)) || '',
	};
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
