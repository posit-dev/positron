/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../path/common/pathService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConfigurationResolverService } from '../../configurationResolver/common/configurationResolver.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Schemas } from '../../../../base/common/network.js';
import { untildify } from '../../../../base/common/labels.js';
import { NotebookSetting } from '../../../contrib/notebook/common/notebookCommon.js';

/**
 * Validates that a URI is an existing directory.
 *
 * @param uri he URI to validate
 * @param fileService The file service
 * @param logService The log service
 * @returns A promise that resolves to true if the URI is a directory and exists,
 * false otherwise.
 */
export async function isValidDirectory(
	uri: URI,
	fileService: IFileService,
	logService: ILogService
): Promise<boolean> {
	try {
		const stat = await fileService.stat(uri);
		if (!stat.isDirectory) {
			logService.warn(`${NotebookSetting.workingDirectory}: Path '${uri}' exists but is not a directory`);
			return false;
		}
		return true;
	} catch (error) {
		logService.warn(`${NotebookSetting.workingDirectory}: Path '${uri}' does not exist or is not accessible:`, error);
		return false;
	}
}

/**
 * Resolves the working directory for a notebook based on its URI and the setting.
 * If the setting doesn't resolve to an existing directory, use the notebook's directory.
 * If the directory doesn't exist, return undefined.
 *
 * @param notebookUri The URI of the notebook
 * @param fileService The file service
 * @param configurationService The configuration service
 * @param configurationResolverService The configuration resolver service
 * @param workspaceContextService The workspace context service
 * @param pathService The path service
 * @param logService The log service
 * @returns The resolved working directory or undefined if it doesn't exist
 */
export async function resolveNotebookWorkingDirectory(
	notebookUri: URI,
	fileService: IFileService,
	configurationService: IConfigurationService,
	configurationResolverService: IConfigurationResolverService,
	workspaceContextService: IWorkspaceContextService,
	pathService: IPathService,
	logService: ILogService
): Promise<string | undefined> {
	// The default value is the notebook's parent directory, if it exists.
	let defaultValue: string | undefined;
	const notebookParent = URI.joinPath(notebookUri, '..');
	if (await isValidDirectory(notebookParent, fileService, logService)) {
		defaultValue = notebookParent.scheme === Schemas.file ? notebookParent.fsPath : notebookParent.path;
	}

	const configValue = configurationService.getValue<string>(
		NotebookSetting.workingDirectory, { resource: notebookUri }
	);
	if (!configValue || configValue.trim() === '') {
		logService.info(`${NotebookSetting.workingDirectory}: Setting is unset. Using default: '${defaultValue}'`);
		return defaultValue;
	}
	const workspaceFolder = workspaceContextService.getWorkspaceFolder(notebookUri);

	// Resolve the variables in the setting
	let resolvedValue: string;
	try {
		resolvedValue = await configurationResolverService.resolveAsync(
			workspaceFolder || undefined, configValue
		);
	} catch (error) {
		logService.warn(`${NotebookSetting.workingDirectory}: Failed to resolve variables in '${configValue}'. Using default: '${defaultValue}'`, error);
		return defaultValue;
	}

	// Check if the result is a directory that exists
	let resolvedValueUri: URI;
	try {
		resolvedValueUri = URI.from({ scheme: pathService.defaultUriScheme, path: resolvedValue });
	} catch (error) {
		logService.warn(`${NotebookSetting.workingDirectory}: Invalid path '${resolvedValue}'. Using default: '${defaultValue}'`, error);
		return defaultValue;
	}
	if (await isValidDirectory(resolvedValueUri, fileService, logService)) {
		logService.info(`${NotebookSetting.workingDirectory}: Resolved '${configValue}' to '${resolvedValue}'`);
		return resolvedValue;
	} else {
		logService.warn(`${NotebookSetting.workingDirectory}: Using default value '${defaultValue}'`);
		return defaultValue;
	}
}

/**
 * Resolves a path by expanding tildes and resolving symlinks.
 *
 * @param path The path to resolve
 * @param fileService The file service
 * @param pathService The path service
 * @param logService The log service
 * @returns The resolved path with tildes expanded and symlinks resolved
 */
export async function resolvePath(
	path: string,
	fileService: IFileService,
	pathService: IPathService,
	logService: ILogService
): Promise<string> {
	const userHome = await pathService.userHome();
	const userHomePath = userHome.scheme === Schemas.file ? userHome.fsPath : userHome.path;

	// First expand tildes
	const untildifiedPath = untildify(path, userHomePath);

	// Then try to resolve symlinks
	try {
		const pathUri = URI.from({ scheme: pathService.defaultUriScheme, path: untildifiedPath });
		const realpath = await fileService.realpath(pathUri);
		return realpath ? (realpath.scheme === Schemas.file ? realpath.fsPath : realpath.path) : untildifiedPath;
	} catch (error) {
		// If realpath fails (e.g., path doesn't exist, permission issues),
		// fall back to the untildified path
		logService.debug(`Failed to resolve symlinks for path '${untildifiedPath}': ${error}`);
		return untildifiedPath;
	}
}

/**
 * Converts an absolute path to a display path relative to the workspace folder.
 *
 * @param absolutePath The absolute path to convert
 * @param notebookUri The URI of the notebook (used to determine workspace folder)
 * @param pathService The path service
 * @param workspaceContextService The workspace context service
 * @returns The display path (relative to workspace if possible, otherwise absolute)
 */
export async function makeDisplayPath(
	absolutePath: string,
	notebookUri: URI,
	pathService: IPathService,
	workspaceContextService: IWorkspaceContextService
): Promise<string> {
	const path = await pathService.path;
	const workspaceFolder = workspaceContextService.getWorkspaceFolder(notebookUri) || undefined;

	if (!workspaceFolder) {
		return absolutePath;
	}

	const workspaceFolderName = workspaceFolder.name;
	const workspaceFolderPath = workspaceFolder.uri.scheme === Schemas.file ? workspaceFolder.uri.fsPath : workspaceFolder.uri.path;
	const relativePath = path.relative(workspaceFolderPath, absolutePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		return absolutePath;
	}

	return path.join(workspaceFolderName, relativePath);
}
