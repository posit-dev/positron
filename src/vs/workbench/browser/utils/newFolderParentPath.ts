/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Schemas } from '../../../base/common/network.js';
import * as resources from '../../../base/common/resources.js';
import { isAbsolute as localPathIsAbsolute, normalize as localPathNormalize } from '../../../base/common/path.js';
import type { PositronReactServices } from '../../../base/browser/positronReactServices.js';

/**
 * The services needed to resolve the default parent folder for a new folder.
 */
export type NewFolderParentPathServices = Pick<
	PositronReactServices,
	'configurationService' | 'fileService' | 'fileDialogService' | 'pathService' | 'workbenchEnvironmentService' | 'logService'
>;

/**
 * Options for resolving a configured path.
 */
interface ResolveConfiguredPathOptions {
	/** Whether the window is local, so the path is on this machine. */
	readonly preferLocal: boolean;
	/** Whether a leading `~` expands to the user home. */
	readonly expandHome: boolean;
	/** Logs why the path cannot be used. */
	readonly logUnusable: (message: string) => void;
}

/**
 * Expands a path of `~`, or `~` and a separator, to the user home.
 * @param services The services to use.
 * @param candidate The path.
 * @param preferLocal Whether the window is local.
 * @returns The user home, or a folder in it. Undefined when the path does not start with `~`.
 */
async function expandHomePath(services: NewFolderParentPathServices, candidate: string, preferLocal: boolean): Promise<URI | undefined> {
	// The separators of the OS where the files are. On POSIX, a backslash is a valid name
	// character, so only a slash separates.
	const separator = (await services.pathService.path).sep === '\\' ? /[\\/]/ : /\//;
	if (candidate !== '~' && !(candidate.startsWith('~') && separator.test(candidate.charAt(1)))) {
		return undefined;
	}

	// Join the segments one at a time, because joinPath does not split on backslashes.
	const segments = candidate.slice(1).split(separator).filter(segment => segment.length > 0);
	const userHome = await services.pathService.userHome({ preferLocal });
	return segments.length > 0 ? resources.joinPath(userHome, ...segments) : userHome;
}

/**
 * Resolves a configured path to an existing folder. This mirrors the validation in
 * `AbstractFileDialogService.preferredHome()`, which upstream may change.
 * @param services The services to use.
 * @param candidate The configured path.
 * @param description Describes the path in log messages.
 * @param options The options.
 * @returns The folder, or undefined when the path is not absolute or does not exist.
 */
async function resolveConfiguredPath(
	services: NewFolderParentPathServices,
	candidate: string,
	description: string,
	options: ResolveConfiguredPathOptions
): Promise<URI | undefined> {
	const { preferLocal } = options;
	let folder = options.expandHome ? await expandHomePath(services, candidate, preferLocal) : undefined;
	if (!folder) {
		const isAbsolute = preferLocal ? localPathIsAbsolute(candidate) : (await services.pathService.path).isAbsolute(candidate);
		if (!isAbsolute) {
			options.logUnusable(`[NewFolderParentPath] ${description} is not absolute: ${candidate}`);
			return undefined;
		}
		const normalized = preferLocal ? localPathNormalize(candidate) : (await services.pathService.path).normalize(candidate);
		folder = resources.toLocalResource(
			await services.pathService.fileURI(normalized),
			services.workbenchEnvironmentService.remoteAuthority,
			services.pathService.defaultUriScheme
		);
	}

	if (!(await services.fileService.exists(folder))) {
		options.logUnusable(`[NewFolderParentPath] ${description} does not exist: ${folder}`);
		return undefined;
	}
	return folder;
}

/**
 * Resolves the default parent folder for a "new folder" flow. Resolution order: the given
 * preferred path (if usable), then the `files.dialog.defaultPath` setting (the policy value first,
 * then the user value), then `IFileDialogService.defaultFolderPath()`.
 *
 * A leading `~` expands to the user home in the preferred path and in the policy value. An
 * enforced setting is one value for every user, so `~` is the only way it can name each user's own
 * home. A user value must be absolute, as in `preferredHome()`.
 * @param services The services to use.
 * @param preferredPath The path to use first, such as a feature-specific setting.
 * @returns The parent folder.
 */
export async function resolveNewFolderParentPath(services: NewFolderParentPathServices, preferredPath?: string): Promise<URI> {
	const preferLocal = services.pathService.defaultUriScheme === Schemas.file;
	const logInfo = (message: string) => services.logService.info(message);
	const logDebug = (message: string) => services.logService.debug(message);

	// Someone set these on purpose, so log at info when they cannot be used.
	const defaultPathConfig = services.configurationService.inspect<string>('files.dialog.defaultPath');
	const candidates = [
		{ value: preferredPath, description: 'Preferred path', expandHome: true, logUnusable: logInfo },
		{ value: defaultPathConfig.policyValue, description: 'files.dialog.defaultPath policy value', expandHome: true, logUnusable: logInfo },
		{
			value: preferLocal ? defaultPathConfig.userLocalValue : defaultPathConfig.userRemoteValue,
			description: 'files.dialog.defaultPath user value',
			expandHome: false,
			logUnusable: logDebug,
		},
	];

	for (const { value, description, expandHome, logUnusable } of candidates) {
		if (value) {
			const folder = await resolveConfiguredPath(services, value, description, { preferLocal, expandHome, logUnusable });
			if (folder) {
				logDebug(`[NewFolderParentPath] Using ${description}: ${folder}`);
				return folder;
			}
		}
	}

	const defaultFolder = await services.fileDialogService.defaultFolderPath();
	logDebug(`[NewFolderParentPath] Using the default folder path: ${defaultFolder}`);
	return defaultFolder;
}

/**
 * Resolves the default parent folder for "New Folder from Git", honoring
 * `git.defaultCloneDirectory` before the general resolution order.
 * @param services The services to use.
 * @returns The parent folder.
 */
export async function resolveGitCloneParentPath(services: NewFolderParentPathServices): Promise<URI> {
	return resolveNewFolderParentPath(
		services,
		services.configurationService.getValue<string | null>('git.defaultCloneDirectory') ?? undefined
	);
}
