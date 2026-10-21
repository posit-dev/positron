/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Schemas } from '../../../base/common/network.js';
import * as resources from '../../../base/common/resources.js';
import { isAbsolute as localPathIsAbsolute, normalize as localPathNormalize } from '../../../base/common/path.js';
import type { PositronReactServices } from '../../../base/browser/positronReactServices.js';
import { expandHomePath } from '../../services/path/common/positronPathUtils.js';
import { checkCanCreateFolderIn } from './createFolder.js';

/**
 * The services needed to resolve the default parent folder for a new folder.
 */
export type NewFolderParentPathServices = Pick<
	PositronReactServices,
	'commandService' | 'configurationService' | 'fileService' | 'fileDialogService' | 'pathService' | 'workbenchEnvironmentService' | 'logService'
>;

/**
 * Resolves a configured path to an existing folder. A leading `~` expands to the user home. Other
 * paths must be absolute, as in `AbstractFileDialogService.preferredHome()`.
 * @param services The services to use.
 * @param candidate The configured path.
 * @returns The folder, or undefined when the path is not absolute or is not an existing folder.
 */
async function resolveConfiguredPath(services: NewFolderParentPathServices, candidate: string): Promise<URI | undefined> {
	const preferLocal = services.pathService.defaultUriScheme === Schemas.file;
	let folder = await expandHomePath(candidate, services.pathService, { preferLocal });
	if (!folder) {
		const isAbsolute = preferLocal ? localPathIsAbsolute(candidate) : (await services.pathService.path).isAbsolute(candidate);
		if (!isAbsolute) {
			services.logService.info(`[NewFolderParentPath] Preferred path is not absolute: ${candidate}`);
			return undefined;
		}
		const normalized = preferLocal ? localPathNormalize(candidate) : (await services.pathService.path).normalize(candidate);
		folder = resources.toLocalResource(
			await services.pathService.fileURI(normalized),
			services.workbenchEnvironmentService.remoteAuthority,
			services.pathService.defaultUriScheme
		);
	}

	let isDirectory = false;
	try {
		isDirectory = (await services.fileService.stat(folder)).isDirectory;
	} catch {
		// The path does not exist.
	}
	if (!isDirectory) {
		services.logService.info(`[NewFolderParentPath] Preferred path is not an existing folder: ${folder}`);
		return undefined;
	}
	return folder;
}

/**
 * Resolves the default parent folder for a "new folder" flow. Resolution order: the given
 * preferred path (if usable), then `IFileDialogService.defaultFolderPath()` (the parent of the
 * workspace) if the user can create a folder there, then `IFileDialogService.preferredHome()` (the
 * `files.dialog.defaultPath` setting, or the user home).
 *
 * The fallback is for servers such as Workbench, where the parent of the workspace is often not
 * writable (`/cloud`, or `/home` when the workspace is the user home).
 * @param services The services to use.
 * @param preferredPath The path to use first, such as a feature-specific setting.
 * @returns The parent folder.
 */
export async function resolveNewFolderParentPath(services: NewFolderParentPathServices, preferredPath?: string): Promise<URI> {
	if (preferredPath) {
		const folder = await resolveConfiguredPath(services, preferredPath);
		if (folder) {
			services.logService.debug(`[NewFolderParentPath] Using the preferred path: ${folder}`);
			return folder;
		}
	}

	const defaultFolder = await services.fileDialogService.defaultFolderPath();
	if (!(await checkCanCreateFolderIn(defaultFolder, services))) {
		services.logService.debug(`[NewFolderParentPath] Using the default folder path: ${defaultFolder}`);
		return defaultFolder;
	}

	const preferredHome = await services.fileDialogService.preferredHome();
	services.logService.info(`[NewFolderParentPath] Cannot create a folder in ${defaultFolder}, so using ${preferredHome}`);
	return preferredHome;
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
